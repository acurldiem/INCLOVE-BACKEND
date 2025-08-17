const mongoose = require('mongoose');

const matchSchema = new mongoose.Schema({
    user1: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        required: true
    },
    user2: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        required: true
    },
    status: {
        type: String,
        enum: ['pending', 'matched', 'unmatched', 'blocked'],
        default: 'pending'
    },
    initiatedBy: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        required: true
    },
    matchType: {
        type: String,
        enum: ['like', 'super_like', 'boost'],
        required: true
    },
    matchScore: {
        type: Number,
        min: 0,
        max: 100,
        default: 0
    },
    interactions: [{
        user: {
            type: mongoose.Schema.Types.ObjectId,
            ref: 'User'
        },
        action: {
            type: String,
            enum: ['like', 'pass', 'super_like', 'unmatch', 'block', 'report']
        },
        timestamp: {
            type: Date,
            default: Date.now
        }
    }],
    lastMessageAt: {
        type: Date
    },
    messageCount: {
        type: Number,
        default: 0
    },
    isActive: {
        type: Boolean,
        default: true
    },
    expiresAt: {
        type: Date
    }
}, {
    timestamps: true
});

// Compound index to prevent duplicate matches
matchSchema.index({ user1: 1, user2: 1 }, { unique: true });
matchSchema.index({ status: 1 });
matchSchema.index({ createdAt: -1 });
matchSchema.index({ lastMessageAt: -1 });

// Ensure user1 is always the smaller ObjectId for consistency
matchSchema.pre('save', function(next) {
    if (this.user1.toString() > this.user2.toString()) {
        [this.user1, this.user2] = [this.user2, this.user1];
    }
    next();
});

// Virtual for getting the other user in the match
matchSchema.virtual('otherUser').get(function() {
    return this.user1.equals(this.currentUser) ? this.user2 : this.user1;
});

// Static method to create or update a match
matchSchema.statics.createMatch = async function(user1Id, user2Id, action, initiatedBy) {
    // Ensure consistent ordering
    const [smallerId, largerId] = [user1Id, user2Id].sort();
    
    try {
        let match = await this.findOne({ user1: smallerId, user2: largerId });
        
        if (!match) {
            // Create new match
            match = new this({
                user1: smallerId,
                user2: largerId,
                initiatedBy,
                matchType: action,
                interactions: [{
                    user: initiatedBy,
                    action: action
                }]
            });
        } else {
            // Update existing match
            const otherUserAction = match.interactions.find(
                interaction => !interaction.user.equals(initiatedBy)
            );
            
            // Add new interaction
            match.interactions.push({
                user: initiatedBy,
                action: action
            });
            
            // Check if it's a mutual match
            if (otherUserAction && 
                (action === 'like' || action === 'super_like') && 
                (otherUserAction.action === 'like' || otherUserAction.action === 'super_like')) {
                match.status = 'matched';
                
                // Set expiration for free users (24 hours to start conversation)
                const user = await mongoose.model('User').findById(initiatedBy);
                if (user.subscription.type === 'free') {
                    match.expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000);
                }
            }
            
            // Handle pass action
            if (action === 'pass') {
                match.status = 'unmatched';
            }
            
            // Handle block action
            if (action === 'block') {
                match.status = 'blocked';
            }
        }
        
        return await match.save();
    } catch (error) {
        throw error;
    }
};

// Static method to get matches for a user
matchSchema.statics.getMatches = function(userId, status = 'matched') {
    return this.find({
        $or: [{ user1: userId }, { user2: userId }],
        status: status,
        isActive: true
    })
    .populate('user1', 'firstName profileImages lastActive')
    .populate('user2', 'firstName profileImages lastActive')
    .sort({ lastMessageAt: -1, createdAt: -1 });
};

// Static method to check if users have interacted
matchSchema.statics.hasInteracted = async function(user1Id, user2Id) {
    const [smallerId, largerId] = [user1Id, user2Id].sort();
    
    const match = await this.findOne({ user1: smallerId, user2: largerId });
    return !!match;
};

// Static method to get potential matches
matchSchema.statics.getPotentialMatches = async function(userId, excludeIds = []) {
    const interactedUserIds = await this.distinct('user1', {
        $or: [{ user1: userId }, { user2: userId }]
    });
    
    const interactedUserIds2 = await this.distinct('user2', {
        $or: [{ user1: userId }, { user2: userId }]
    });
    
    const allInteractedIds = [...new Set([...interactedUserIds, ...interactedUserIds2])];
    
    return [...allInteractedIds, ...excludeIds, userId];
};

// Method to calculate match score based on compatibility
matchSchema.methods.calculateMatchScore = async function() {
    const Profile = mongoose.model('Profile');
    
    const profile1 = await Profile.findOne({ user: this.user1 });
    const profile2 = await Profile.findOne({ user: this.user2 });
    
    if (!profile1 || !profile2) {
        this.matchScore = 0;
        return 0;
    }
    
    let score = 0;
    let maxScore = 0;
    
    // Common interests (30 points)
    if (profile1.interests && profile2.interests) {
        const commonInterests = profile1.interests.filter(
            interest => profile2.interests.includes(interest)
        );
        score += Math.min(commonInterests.length * 5, 30);
    }
    maxScore += 30;
    
    // Compatible lifestyle (25 points)
    if (profile1.lifestyle && profile2.lifestyle) {
        if (profile1.lifestyle.smoking === profile2.lifestyle.smoking) score += 8;
        if (profile1.lifestyle.drinking === profile2.lifestyle.drinking) score += 8;
        if (profile1.lifestyle.exercise === profile2.lifestyle.exercise) score += 5;
        if (profile1.lifestyle.diet === profile2.lifestyle.diet) score += 4;
    }
    maxScore += 25;
    
    // Education compatibility (15 points)
    if (profile1.education && profile2.education) {
        if (profile1.education.school === profile2.education.school) score += 10;
        else if (profile1.education.degree === profile2.education.degree) score += 5;
    }
    maxScore += 15;
    
    // Relationship goals (20 points)
    if (profile1.relationshipGoals === profile2.relationshipGoals) {
        score += 20;
    }
    maxScore += 20;
    
    // Common languages (10 points)
    if (profile1.languages && profile2.languages) {
        const commonLanguages = profile1.languages.filter(
            lang1 => profile2.languages.some(lang2 => lang1.language === lang2.language)
        );
        score += Math.min(commonLanguages.length * 3, 10);
    }
    maxScore += 10;
    
    this.matchScore = Math.round((score / maxScore) * 100);
    return this.matchScore;
};

// Method to update message statistics
matchSchema.methods.updateMessageStats = async function() {
    const Message = mongoose.model('Message');
    
    const messageCount = await Message.countDocuments({ match: this._id });
    const lastMessage = await Message.findOne({ match: this._id })
        .sort({ createdAt: -1 });
    
    this.messageCount = messageCount;
    this.lastMessageAt = lastMessage ? lastMessage.createdAt : null;
    
    return this.save();
};

module.exports = mongoose.model('Match', matchSchema);