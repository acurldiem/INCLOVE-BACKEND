const mongoose = require('mongoose');

const messageSchema = new mongoose.Schema({
    match: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Match',
        required: true
    },
    sender: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        required: true
    },
    receiver: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        required: true
    },
    content: {
        text: {
            type: String,
            maxlength: [1000, 'Message cannot exceed 1000 characters']
        },
        type: {
            type: String,
            enum: ['text', 'image', 'gif', 'audio', 'video', 'location', 'sticker'],
            default: 'text'
        },
        media: {
            url: String,
            fileName: String,
            fileSize: Number,
            mimeType: String,
            duration: Number // for audio/video
        },
        location: {
            latitude: Number,
            longitude: Number,
            address: String
        }
    },
    status: {
        type: String,
        enum: ['sent', 'delivered', 'read'],
        default: 'sent'
    },
    readAt: {
        type: Date
    },
    deliveredAt: {
        type: Date
    },
    isEdited: {
        type: Boolean,
        default: false
    },
    editedAt: {
        type: Date
    },
    originalContent: {
        type: String
    },
    replyTo: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Message'
    },
    reactions: [{
        user: {
            type: mongoose.Schema.Types.ObjectId,
            ref: 'User'
        },
        emoji: {
            type: String,
            required: true
        },
        createdAt: {
            type: Date,
            default: Date.now
        }
    }],
    isDeleted: {
        type: Boolean,
        default: false
    },
    deletedAt: {
        type: Date
    },
    deletedBy: [{
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User'
    }],
    metadata: {
        ipAddress: String,
        userAgent: String,
        platform: String
    }
}, {
    timestamps: true
});

// Indexes for efficient querying
messageSchema.index({ match: 1, createdAt: -1 });
messageSchema.index({ sender: 1, createdAt: -1 });
messageSchema.index({ status: 1 });
messageSchema.index({ createdAt: -1 });

// Validate message content
messageSchema.pre('validate', function(next) {
    if (this.content.type === 'text' && !this.content.text) {
        return next(new Error('Text message must have content'));
    }
    
    if (this.content.type !== 'text' && !this.content.media.url) {
        return next(new Error('Media message must have media URL'));
    }
    
    next();
});

// Update match's message statistics after saving
messageSchema.post('save', async function() {
    try {
        const Match = mongoose.model('Match');
        const match = await Match.findById(this.match);
        
        if (match) {
            await match.updateMessageStats();
        }
    } catch (error) {
        console.error('Error updating match stats:', error);
    }
});

// Static method to get conversation messages
messageSchema.statics.getConversation = function(matchId, page = 1, limit = 50) {
    const skip = (page - 1) * limit;
    
    return this.find({ 
        match: matchId,
        isDeleted: false 
    })
    .populate('sender', 'firstName profileImages')
    .populate('receiver', 'firstName profileImages')
    .populate('replyTo', 'content.text sender')
    .sort({ createdAt: -1 })
    .limit(limit)
    .skip(skip);
};

// Static method to mark messages as read
messageSchema.statics.markAsRead = async function(matchId, userId) {
    const result = await this.updateMany(
        {
            match: matchId,
            receiver: userId,
            status: { $ne: 'read' }
        },
        {
            status: 'read',
            readAt: new Date()
        }
    );
    
    return result;
};

// Static method to get unread count
messageSchema.statics.getUnreadCount = function(userId) {
    return this.countDocuments({
        receiver: userId,
        status: { $ne: 'read' },
        isDeleted: false
    });
};

// Static method to get recent conversations
messageSchema.statics.getRecentConversations = function(userId, limit = 20) {
    return this.aggregate([
        {
            $match: {
                $or: [{ sender: userId }, { receiver: userId }],
                isDeleted: false
            }
        },
        {
            $sort: { createdAt: -1 }
        },
        {
            $group: {
                _id: '$match',
                lastMessage: { $first: '$ROOT' },
                unreadCount: {
                    $sum: {
                        $cond: [
                            {
                                $and: [
                                    { $eq: ['$receiver', userId] },
                                    { $ne: ['$status', 'read'] }
                                ]
                            },
                            1,
                            0
                        ]
                    }
                }
            }
        },
        {
            $sort: { 'lastMessage.createdAt': -1 }
        },
        {
            $limit: limit
        },
        {
            $lookup: {
                from: 'matches',
                localField: '_id',
                foreignField: '_id',
                as: 'match'
            }
        },
        {
            $unwind: '$match'
        },
        {
            $lookup: {
                from: 'users',
                localField: 'match.user1',
                foreignField: '_id',
                as: 'user1'
            }
        },
        {
            $lookup: {
                from: 'users',
                localField: 'match.user2',
                foreignField: '_id',
                as: 'user2'
            }
        },
        {
            $addFields: {
                otherUser: {
                    $cond: [
                        { $eq: ['$match.user1._id', userId] },
                        { $arrayElemAt: ['$user2', 0] },
                        { $arrayElemAt: ['$user1', 0] }
                    ]
                }
            }
        },
        {
            $project: {
                lastMessage: 1,
                unreadCount: 1,
                match: 1,
                'otherUser.firstName': 1,
                'otherUser.profileImages': 1,
                'otherUser.lastActive': 1
            }
        }
    ]);
};

// Method to add reaction
messageSchema.methods.addReaction = function(userId, emoji) {
    // Remove existing reaction from this user
    this.reactions = this.reactions.filter(
        reaction => !reaction.user.equals(userId)
    );
    
    // Add new reaction
    this.reactions.push({
        user: userId,
        emoji: emoji
    });
    
    return this.save();
};

// Method to remove reaction
messageSchema.methods.removeReaction = function(userId) {
    this.reactions = this.reactions.filter(
        reaction => !reaction.user.equals(userId)
    );
    
    return this.save();
};

// Method to soft delete message
messageSchema.methods.softDelete = function(userId) {
    if (!this.deletedBy.includes(userId)) {
        this.deletedBy.push(userId);
    }
    
    // If both users deleted, mark as deleted
    if (this.deletedBy.length >= 2) {
        this.isDeleted = true;
        this.deletedAt = new Date();
    }
    
    return this.save();
};

// Method to edit message
messageSchema.methods.editMessage = function(newContent) {
    if (this.content.type !== 'text') {
        throw new Error('Only text messages can be edited');
    }
    
    this.originalContent = this.content.text;
    this.content.text = newContent;
    this.isEdited = true;
    this.editedAt = new Date();
    
    return this.save();
};

// Virtual to check if message is from current user
messageSchema.virtual('isFromCurrentUser').get(function() {
    return this.sender.equals(this.currentUserId);
});

// Method to get message reactions count
messageSchema.methods.getReactionsCount = function() {
    const reactionCounts = {};
    
    this.reactions.forEach(reaction => {
        if (reactionCounts[reaction.emoji]) {
            reactionCounts[reaction.emoji]++;
        } else {
            reactionCounts[reaction.emoji] = 1;
        }
    });
    
    return reactionCounts;
};

// Static method to search messages
messageSchema.statics.searchMessages = function(matchId, query, limit = 20) {
    return this.find({
        match: matchId,
        'content.text': { $regex: query, $options: 'i' },
        isDeleted: false
    })
    .populate('sender', 'firstName')
    .sort({ createdAt: -1 })
    .limit(limit);
};

// Static method to get media messages
messageSchema.statics.getMediaMessages = function(matchId, mediaType = null) {
    const query = {
        match: matchId,
        'content.type': { $ne: 'text' },
        isDeleted: false
    };
    
    if (mediaType) {
        query['content.type'] = mediaType;
    }
    
    return this.find(query)
    .populate('sender', 'firstName')
    .sort({ createdAt: -1 });
};

// Static method to get message statistics
messageSchema.statics.getMessageStats = function(userId) {
    return this.aggregate([
        {
            $match: {
                $or: [{ sender: userId }, { receiver: userId }],
                isDeleted: false
            }
        },
        {
            $group: {
                _id: null,
                totalMessages: { $sum: 1 },
                sentMessages: {
                    $sum: {
                        $cond: [{ $eq: ['$sender', userId] }, 1, 0]
                    }
                },
                receivedMessages: {
                    $sum: {
                        $cond: [{ $eq: ['$receiver', userId] }, 1, 0]
                    }
                },
                mediaMessages: {
                    $sum: {
                        $cond: [{ $ne: ['$content.type', 'text'] }, 1, 0]
                    }
                },
                averageMessageLength: {
                    $avg: { $strLenCP: '$content.text' }
                }
            }
        }
    ]);
};

// Index for text search
messageSchema.index({ 'content.text': 'text' });

module.exports = mongoose.model('Message', messageSchema);