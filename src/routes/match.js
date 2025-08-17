const express = require('express');
const Match = require('../models/Match');
const User = require('../models/User');
const { protect, requirePremium, rateLimitByUser } = require('../middleware/authMiddleware');

const router = express.Router();

// @desc    Like a user
// @route   POST /api/matches/like/:userId
// @access  Private
router.post('/like/:userId', protect, rateLimitByUser(100, 60 * 60 * 1000), async (req, res) => {
    try {
        const targetUserId = req.params.userId;
        const currentUserId = req.user.id;

        if (targetUserId === currentUserId) {
            return res.status(400).json({
                success: false,
                message: 'You cannot like yourself'
            });
        }

        // Check if target user exists and is active
        const targetUser = await User.findById(targetUserId);
        if (!targetUser || !targetUser.isActive) {
            return res.status(404).json({
                success: false,
                message: 'User not found'
            });
        }

        // Check if current user is blocked by target user
        if (targetUser.blockedUsers.includes(currentUserId)) {
            return res.status(403).json({
                success: false,
                message: 'You cannot interact with this user'
            });
        }

        // Check if users have already interacted
        const existingMatch = await Match.hasInteracted(currentUserId, targetUserId);
        if (existingMatch) {
            return res.status(400).json({
                success: false,
                message: 'You have already interacted with this user'
            });
        }

        // Create or update match
        const match = await Match.createMatch(currentUserId, targetUserId, 'like', currentUserId);

        let responseMessage = 'Like sent successfully';
        let isMatch = false;

        if (match.status === 'matched') {
            responseMessage = "It's a match! 🎉";
            isMatch = true;
        }

        res.status(200).json({
            success: true,
            message: responseMessage,
            data: {
                match,
                isMatch,
                matchScore: match.matchScore
            }
        });

    } catch (error) {
        console.error('Like user error:', error);
        res.status(500).json({
            success: false,
            message: 'Server error'
        });
    }
});

// @desc    Super like a user (premium feature)
// @route   POST /api/matches/super-like/:userId
// @access  Private (Premium)
router.post('/super-like/:userId', protect, requirePremium('super_likes'), async (req, res) => {
    try {
        const targetUserId = req.params.userId;
        const currentUserId = req.user.id;

        if (targetUserId === currentUserId) {
            return res.status(400).json({
                success: false,
                message: 'You cannot super like yourself'
            });
        }

        // Check daily super like limit
        const today = new Date();
        today.setHours(0, 0, 0, 0);
        
        const superLikesToday = await Match.countDocuments({
            initiatedBy: currentUserId,
            matchType: 'super_like',
            createdAt: { $gte: today }
        });

        const superLikeLimit = req.user.subscription.type === 'gold' ? 5 : 1;
        if (superLikesToday >= superLikeLimit) {
            return res.status(400).json({
                success: false,
                message: `You have reached your daily super like limit (${superLikeLimit})`
            });
        }

        const targetUser = await User.findById(targetUserId);
        if (!targetUser || !targetUser.isActive) {
            return res.status(404).json({
                success: false,
                message: 'User not found'
            });
        }

        if (targetUser.blockedUsers.includes(currentUserId)) {
            return res.status(403).json({
                success: false,
                message: 'You cannot interact with this user'
            });
        }

        const existingMatch = await Match.hasInteracted(currentUserId, targetUserId);
        if (existingMatch) {
            return res.status(400).json({
                success: false,
                message: 'You have already interacted with this user'
            });
        }

        const match = await Match.createMatch(currentUserId, targetUserId, 'super_like', currentUserId);

        let responseMessage = 'Super like sent successfully ⭐';
        let isMatch = false;

        if (match.status === 'matched') {
            responseMessage = "It's a super match! 🌟";
            isMatch = true;
        }

        res.status(200).json({
            success: true,
            message: responseMessage,
            data: {
                match,
                isMatch,
                matchScore: match.matchScore
            }
        });

    } catch (error) {
        console.error('Super like user error:', error);
        res.status(500).json({
            success: false,
            message: 'Server error'
        });
    }
});

// @desc    Pass on a user
// @route   POST /api/matches/pass/:userId
// @access  Private
router.post('/pass/:userId', protect, async (req, res) => {
    try {
        const targetUserId = req.params.userId;
        const currentUserId = req.user.id;

        if (targetUserId === currentUserId) {
            return res.status(400).json({
                success: false,
                message: 'Invalid action'
            });
        }

        const targetUser = await User.findById(targetUserId);
        if (!targetUser) {
            return res.status(404).json({
                success: false,
                message: 'User not found'
            });
        }

        const match = await Match.createMatch(currentUserId, targetUserId, 'pass', currentUserId);

        res.status(200).json({
            success: true,
            message: 'User passed',
            data: { match }
        });

    } catch (error) {
        console.error('Pass user error:', error);
        res.status(500).json({
            success: false,
            message: 'Server error'
        });
    }
});

// @desc    Unmatch with a user
// @route   DELETE /api/matches/:matchId
// @access  Private
router.delete('/:matchId', protect, async (req, res) => {
    try {
        const match = await Match.findById(req.params.matchId);

        if (!match) {
            return res.status(404).json({
                success: false,
                message: 'Match not found'
            });
        }

        // Check if user is part of this match
        if (!match.user1.equals(req.user.id) && !match.user2.equals(req.user.id)) {
            return res.status(403).json({
                success: false,
                message: 'Access denied'
            });
        }

        // Add unmatch interaction
        match.interactions.push({
            user: req.user.id,
            action: 'unmatch'
        });

        match.status = 'unmatched';
        match.isActive = false;
        await match.save();

        res.status(200).json({
            success: true,
            message: 'Successfully unmatched'
        });

    } catch (error) {
        console.error('Unmatch error:', error);
        res.status(500).json({
            success: false,
            message: 'Server error'
        });
    }
});

// @desc    Get all matches for current user
// @route   GET /api/matches
// @access  Private
router.get('/', protect, async (req, res) => {
    try {
        const { page = 1, limit = 20, status = 'matched' } = req.query;

        const matches = await Match.getMatches(req.user.id, status);

        // Format matches for response
        const formattedMatches = matches.map(match => {
            const otherUser = match.user1.equals(req.user.id) ? match.user2 : match.user1;
            
            return {
                _id: match._id,
                user: otherUser,
                matchScore: match.matchScore,
                createdAt: match.createdAt,
                lastMessageAt: match.lastMessageAt,
                messageCount: match.messageCount,
                expiresAt: match.expiresAt,
                isNewMatch: !match.lastMessageAt
            };
        });

        // Pagination
        const startIndex = (page - 1) * limit;
        const endIndex = page * limit;
        const paginatedMatches = formattedMatches.slice(startIndex, endIndex);

        res.status(200).json({
            success: true,
            data: {
                matches: paginatedMatches,
                pagination: {
                    current: parseInt(page),
                    limit: parseInt(limit),
                    total: formattedMatches.length
                }
            }
        });

    } catch (error) {
        console.error('Get matches error:', error);
        res.status(500).json({
            success: false,
            message: 'Server error'
        });
    }
});

// @desc    Get match details
// @route   GET /api/matches/:matchId
// @access  Private
router.get('/:matchId', protect, async (req, res) => {
    try {
        const match = await Match.findById(req.params.matchId)
            .populate('user1', 'firstName profileImages lastActive')
            .populate('user2', 'firstName profileImages lastActive');

        if (!match) {
            return res.status(404).json({
                success: false,
                message: 'Match not found'
            });
        }

        // Check if user is part of this match
        if (!match.user1._id.equals(req.user.id) && !match.user2._id.equals(req.user.id)) {
            return res.status(403).json({
                success: false,
                message: 'Access denied'
            });
        }

        // Get the other user
        const otherUser = match.user1._id.equals(req.user.id) ? match.user2 : match.user1;

        res.status(200).json({
            success: true,
            data: {
                match: {
                    _id: match._id,
                    otherUser,
                    matchScore: match.matchScore,
                    status: match.status,
                    createdAt: match.createdAt,
                    lastMessageAt: match.lastMessageAt,
                    messageCount: match.messageCount,
                    expiresAt: match.expiresAt
                }
            }
        });

    } catch (error) {
        console.error('Get match details error:', error);
        res.status(500).json({
            success: false,
            message: 'Server error'
        });
    }
});

// @desc    Get likes received (who liked me)
// @route   GET /api/matches/likes/received
// @access  Private (Premium for seeing who liked you)
router.get('/likes/received', protect, requirePremium('see_likes'), async (req, res) => {
    try {
        const { page = 1, limit = 20 } = req.query;

        const likes = await Match.find({
            $or: [{ user1: req.user.id }, { user2: req.user.id }],
            initiatedBy: { $ne: req.user.id },
            status: 'pending',
            'interactions.action': { $in: ['like', 'super_like'] }
        })
        .populate('user1', 'firstName profileImages lastActive')
        .populate('user2', 'firstName profileImages lastActive')
        .sort({ createdAt: -1 });

        // Format likes
        const formattedLikes = likes.map(like => {
            const liker = like.user1.equals(req.user.id) ? like.user2 : like.user1;
            const likeAction = like.interactions.find(i => 
                !i.user.equals(req.user.id) && ['like', 'super_like'].includes(i.action)
            );

            return {
                _id: like._id,
                user: liker,
                type: likeAction.action,
                createdAt: likeAction.timestamp,
                matchScore: like.matchScore
            };
        });

        // Pagination
        const startIndex = (page - 1) * limit;
        const endIndex = page * limit;
        const paginatedLikes = formattedLikes.slice(startIndex, endIndex);

        res.status(200).json({
            success: true,
            data: {
                likes: paginatedLikes,
                pagination: {
                    current: parseInt(page),
                    limit: parseInt(limit),
                    total: formattedLikes.length
                }
            }
        });

    } catch (error) {
        console.error('Get received likes error:', error);
        res.status(500).json({
            success: false,
            message: 'Server error'
        });
    }
});

// @desc    Get match statistics
// @route   GET /api/matches/stats
// @access  Private
router.get('/stats/overview', protect, async (req, res) => {
    try {
        const userId = req.user.id;

        const stats = await Match.aggregate([
            {
                $match: {
                    $or: [{ user1: userId }, { user2: userId }]
                }
            },
            {
                $group: {
                    _id: '$status',
                    count: { $sum: 1 }
                }
            }
        ]);

        const totalInteractions = await Match.countDocuments({
            initiatedBy: userId
        });

        const formattedStats = {
            totalMatches: 0,
            pendingLikes: 0,
            totalInteractions,
            matchRate: 0
        };

        stats.forEach(stat => {
            if (stat._id === 'matched') formattedStats.totalMatches = stat.count;
            if (stat._id === 'pending') formattedStats.pendingLikes = stat.count;
        });

        if (totalInteractions > 0) {
            formattedStats.matchRate = ((formattedStats.totalMatches / totalInteractions) * 100).toFixed(1);
        }

        res.status(200).json({
            success: true,
            data: formattedStats
        });

    } catch (error) {
        console.error('Get match stats error:', error);
        res.status(500).json({
            success: false,
            message: 'Server error'
        });
    }
});

// @desc    Rewind last action (premium feature)
// @route   POST /api/matches/rewind
// @access  Private (Premium)
router.post('/rewind', protect, requirePremium('rewind'), async (req, res) => {
    try {
        // Get the last match action by this user
        const lastMatch = await Match.findOne({
            initiatedBy: req.user.id
        }).sort({ createdAt: -1 });

        if (!lastMatch) {
            return res.status(404).json({
                success: false,
                message: 'No recent action to rewind'
            });
        }

        // Check if rewind is possible (within last 24 hours)
        const twentyFourHoursAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);
        if (lastMatch.createdAt < twentyFourHoursAgo) {
            return res.status(400).json({
                success: false,
                message: 'Can only rewind actions within the last 24 hours'
            });
        }

        // Remove the match
        await Match.findByIdAndDelete(lastMatch._id);

        res.status(200).json({
            success: true,
            message: 'Action rewound successfully'
        });

    } catch (error) {
        console.error('Rewind action error:', error);
        res.status(500).json({
            success: false,
            message: 'Server error'
        });
    }
});

module.exports = router;