const express = require('express');
const Message = require('../models/Message');
const Match = require('../models/Match');
const { protect, requirePremium } = require('../middleware/authMiddleware');

const router = express.Router();

// @desc    Send a message
// @route   POST /api/messages
// @access  Private
router.post('/', protect, async (req, res) => {
    try {
        const { matchId, content, replyTo } = req.body;
        const senderId = req.user.id;

        // Validate match
        const match = await Match.findById(matchId);
        if (!match) {
            return res.status(404).json({
                success: false,
                message: 'Match not found'
            });
        }

        // Check if user is part of this match
        if (!match.user1.equals(senderId) && !match.user2.equals(senderId)) {
            return res.status(403).json({
                success: false,
                message: 'Access denied'
            });
        }

        // Check if match is still active
        if (match.status !== 'matched' || !match.isActive) {
            return res.status(400).json({
                success: false,
                message: 'Cannot send message to inactive match'
            });
        }

        // Check if match has expired (for free users)
        if (match.expiresAt && match.expiresAt < new Date()) {
            return res.status(400).json({
                success: false,
                message: 'Match has expired. Upgrade to premium to continue chatting.'
            });
        }

        // Determine receiver
        const receiverId = match.user1.equals(senderId) ? match.user2 : match.user1;

        // Validate content
        if (!content || (!content.text && !content.media)) {
            return res.status(400).json({
                success: false,
                message: 'Message content is required'
            });
        }

        // Create message
        const messageData = {
            match: matchId,
            sender: senderId,
            receiver: receiverId,
            content: {
                text: content.text,
                type: content.type || 'text',
                media: content.media,
                location: content.location
            }
        };

        if (replyTo) {
            messageData.replyTo = replyTo;
        }

        const message = await Message.create(messageData);
        
        // Populate message for response
        await message.populate([
            { path: 'sender', select: 'firstName profileImages' },
            { path: 'receiver', select: 'firstName profileImages' },
            { path: 'replyTo', select: 'content.text sender' }
        ]);

        // Update match's last message timestamp
        match.lastMessageAt = new Date();
        await match.save();

        res.status(201).json({
            success: true,
            message: 'Message sent successfully',
            data: { message }
        });

    } catch (error) {
        console.error('Send message error:', error);
        res.status(500).json({
            success: false,
            message: 'Server error'
        });
    }
});

// @desc    Get messages for a match (conversation)
// @route   GET /api/messages/match/:matchId
// @access  Private
router.get('/match/:matchId', protect, async (req, res) => {
    try {
        const { matchId } = req.params;
        const { page = 1, limit = 50 } = req.query;

        // Validate match and user access
        const match = await Match.findById(matchId);
        if (!match) {
            return res.status(404).json({
                success: false,
                message: 'Match not found'
            });
        }

        if (!match.user1.equals(req.user.id) && !match.user2.equals(req.user.id)) {
            return res.status(403).json({
                success: false,
                message: 'Access denied'
            });
        }

        // Get messages
        const messages = await Message.getConversation(matchId, parseInt(page), parseInt(limit));

        // Mark messages as read
        await Message.markAsRead(matchId, req.user.id);

        res.status(200).json({
            success: true,
            data: {
                messages: messages.reverse(), // Reverse to show oldest first
                pagination: {
                    current: parseInt(page),
                    limit: parseInt(limit),
                    hasMore: messages.length === parseInt(limit)
                }
            }
        });

    } catch (error) {
        console.error('Get messages error:', error);
        res.status(500).json({
            success: false,
            message: 'Server error'
        });
    }
});

// @desc    Get all conversations for current user
// @route   GET /api/messages/conversations
// @access  Private
router.get('/conversations', protect, async (req, res) => {
    try {
        const { limit = 20 } = req.query;

        const conversations = await Message.getRecentConversations(req.user.id, parseInt(limit));

        res.status(200).json({
            success: true,
            data: { conversations }
        });

    } catch (error) {
        console.error('Get conversations error:', error);
        res.status(500).json({
            success: false,
            message: 'Server error'
        });
    }
});

// @desc    Mark message as read
// @route   PUT /api/messages/:messageId/read
// @access  Private
router.put('/:messageId/read', protect, async (req, res) => {
    try {
        const message = await Message.findById(req.params.messageId);

        if (!message) {
            return res.status(404).json({
                success: false,
                message: 'Message not found'
            });
        }

        // Check if user is the receiver
        if (!message.receiver.equals(req.user.id)) {
            return res.status(403).json({
                success: false,
                message: 'Access denied'
            });
        }

        if (message.status !== 'read') {
            message.status = 'read';
            message.readAt = new Date();
            await message.save();
        }

        res.status(200).json({
            success: true,
            message: 'Message marked as read'
        });

    } catch (error) {
        console.error('Mark message as read error:', error);
        res.status(500).json({
            success: false,
            message: 'Server error'
        });
    }
});

// @desc    Edit message
// @route   PUT /api/messages/:messageId
// @access  Private
router.put('/:messageId', protect, async (req, res) => {
    try {
        const { content } = req.body;
        const message = await Message.findById(req.params.messageId);

        if (!message) {
            return res.status(404).json({
                success: false,
                message: 'Message not found'
            });
        }

        // Check if user is the sender
        if (!message.sender.equals(req.user.id)) {
            return res.status(403).json({
                success: false,
                message: 'You can only edit your own messages'
            });
        }

        // Check if message is too old to edit (15 minutes)
        const fifteenMinutesAgo = new Date(Date.now() - 15 * 60 * 1000);
        if (message.createdAt < fifteenMinutesAgo) {
            return res.status(400).json({
                success: false,
                message: 'Messages can only be edited within 15 minutes of sending'
            });
        }

        await message.editMessage(content);

        await message.populate([
            { path: 'sender', select: 'firstName profileImages' },
            { path: 'receiver', select: 'firstName profileImages' }
        ]);

        res.status(200).json({
            success: true,
            message: 'Message edited successfully',
            data: { message }
        });

    } catch (error) {
        console.error('Edit message error:', error);
        res.status(500).json({
            success: false,
            message: error.message || 'Server error'
        });
    }
});

// @desc    Delete message
// @route   DELETE /api/messages/:messageId
// @access  Private
router.delete('/:messageId', protect, async (req, res) => {
    try {
        const message = await Message.findById(req.params.messageId);

        if (!message) {
            return res.status(404).json({
                success: false,
                message: 'Message not found'
            });
        }

        // Check if user is sender or receiver
        if (!message.sender.equals(req.user.id) && !message.receiver.equals(req.user.id)) {
            return res.status(403).json({
                success: false,
                message: 'Access denied'
            });
        }

        await message.softDelete(req.user.id);

        res.status(200).json({
            success: true,
            message: 'Message deleted successfully'
        });

    } catch (error) {
        console.error('Delete message error:', error);
        res.status(500).json({
            success: false,
            message: 'Server error'
        });
    }
});

// @desc    Add reaction to message
// @route   POST /api/messages/:messageId/reactions
// @access  Private
router.post('/:messageId/reactions', protect, async (req, res) => {
    try {
        const { emoji } = req.body;
        const message = await Message.findById(req.params.messageId);

        if (!message) {
            return res.status(404).json({
                success: false,
                message: 'Message not found'
            });
        }

        // Check if user is part of the conversation
        if (!message.sender.equals(req.user.id) && !message.receiver.equals(req.user.id)) {
            return res.status(403).json({
                success: false,
                message: 'Access denied'
            });
        }

        if (!emoji) {
            return res.status(400).json({
                success: false,
                message: 'Emoji is required'
            });
        }

        await message.addReaction(req.user.id, emoji);

        res.status(200).json({
            success: true,
            message: 'Reaction added successfully',
            data: { reactions: message.reactions }
        });

    } catch (error) {
        console.error('Add reaction error:', error);
        res.status(500).json({
            success: false,
            message: 'Server error'
        });
    }
});

// @desc    Remove reaction from message
// @route   DELETE /api/messages/:messageId/reactions
// @access  Private
router.delete('/:messageId/reactions', protect, async (req, res) => {
    try {
        const message = await Message.findById(req.params.messageId);

        if (!message) {
            return res.status(404).json({
                success: false,
                message: 'Message not found'
            });
        }

        // Check if user is part of the conversation
        if (!message.sender.equals(req.user.id) && !message.receiver.equals(req.user.id)) {
            return res.status(403).json({
                success: false,
                message: 'Access denied'
            });
        }

        await message.removeReaction(req.user.id);

        res.status(200).json({
            success: true,
            message: 'Reaction removed successfully',
            data: { reactions: message.reactions }
        });

    } catch (error) {
        console.error('Remove reaction error:', error);
        res.status(500).json({
            success: false,
            message: 'Server error'
        });
    }
});

// @desc    Search messages in a conversation
// @route   GET /api/messages/match/:matchId/search
// @access  Private
router.get('/match/:matchId/search', protect, async (req, res) => {
    try {
        const { matchId } = req.params;
        const { query, limit = 20 } = req.query;

        if (!query) {
            return res.status(400).json({
                success: false,
                message: 'Search query is required'
            });
        }

        // Validate match access
        const match = await Match.findById(matchId);
        if (!match) {
            return res.status(404).json({
                success: false,
                message: 'Match not found'
            });
        }

        if (!match.user1.equals(req.user.id) && !match.user2.equals(req.user.id)) {
            return res.status(403).json({
                success: false,
                message: 'Access denied'
            });
        }

        const messages = await Message.searchMessages(matchId, query, parseInt(limit));

        res.status(200).json({
            success: true,
            data: { messages }
        });

    } catch (error) {
        console.error('Search messages error:', error);
        res.status(500).json({
            success: false,
            message: 'Server error'
        });
    }
});

// @desc    Get media messages from a conversation
// @route   GET /api/messages/match/:matchId/media
// @access  Private
router.get('/match/:matchId/media', protect, async (req, res) => {
    try {
        const { matchId } = req.params;
        const { type } = req.query; // image, video, audio, etc.

        // Validate match access
        const match = await Match.findById(matchId);
        if (!match) {
            return res.status(404).json({
                success: false,
                message: 'Match not found'
            });
        }

        if (!match.user1.equals(req.user.id) && !match.user2.equals(req.user.id)) {
            return res.status(403).json({
                success: false,
                message: 'Access denied'
            });
        }

        const mediaMessages = await Message.getMediaMessages(matchId, type);

        res.status(200).json({
            success: true,
            data: { mediaMessages }
        });

    } catch (error) {
        console.error('Get media messages error:', error);
        res.status(500).json({
            success: false,
            message: 'Server error'
        });
    }
});

// @desc    Get unread message count
// @route   GET /api/messages/unread-count
// @access  Private
router.get('/unread-count', protect, async (req, res) => {
    try {
        const unreadCount = await Message.getUnreadCount(req.user.id);

        res.status(200).json({
            success: true,
            data: { unreadCount }
        });

    } catch (error) {
        console.error('Get unread count error:', error);
        res.status(500).json({
            success: false,
            message: 'Server error'
        });
    }
});

// @desc    Get message statistics
// @route   GET /api/messages/stats
// @access  Private
router.get('/stats', protect, async (req, res) => {
    try {
        const stats = await Message.getMessageStats(req.user.id);

        res.status(200).json({
            success: true,
            data: { stats: stats[0] || {
                totalMessages: 0,
                sentMessages: 0,
                receivedMessages: 0,
                mediaMessages: 0,
                averageMessageLength: 0
            }}
        });

    } catch (error) {
        console.error('Get message stats error:', error);
        res.status(500).json({
            success: false,
            message: 'Server error'
        });
    }
});

// @desc    Send typing indicator (premium feature for read receipts)
// @route   POST /api/messages/typing
// @access  Private
router.post('/typing', protect, async (req, res) => {
    try {
        const { matchId, isTyping } = req.body;

        // Validate match
        const match = await Match.findById(matchId);
        if (!match) {
            return res.status(404).json({
                success: false,
                message: 'Match not found'
            });
        }

        if (!match.user1.equals(req.user.id) && !match.user2.equals(req.user.id)) {
            return res.status(403).json({
                success: false,
                message: 'Access denied'
            });
        }

        // In a real implementation, this would emit a socket event
        // For now, just return success
        res.status(200).json({
            success: true,
            message: 'Typing status updated'
        });

    } catch (error) {
        console.error('Update typing status error:', error);
        res.status(500).json({
            success: false,
            message: 'Server error'
        });
    }
});

module.exports = router;