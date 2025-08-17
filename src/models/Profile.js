const mongoose = require('mongoose');

const profileSchema = new mongoose.Schema({
    user: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        required: true,
        unique: true
    },
    bio: {
        type: String,
        maxlength: [500, 'Bio cannot exceed 500 characters'],
        trim: true
    },
    occupation: {
        job: String,
        company: String,
        industry: String
    },
    education: {
        school: String,
        degree: String,
        fieldOfStudy: String,
        graduationYear: Number
    },
    height: {
        type: Number, // in centimeters
        min: [100, 'Height must be realistic'],
        max: [300, 'Height must be realistic']
    },
    bodyType: {
        type: String,
        enum: ['slim', 'athletic', 'average', 'curvy', 'muscular', 'plus-size']
    },
    ethnicity: {
        type: String,
        enum: [
            'asian',
            'black',
            'hispanic',
            'white',
            'middle-eastern',
            'native-american',
            'pacific-islander',
            'mixed',
            'other',
            'prefer-not-to-say'
        ]
    },
    religion: {
        type: String,
        enum: [
            'christian',
            'muslim',
            'jewish',
            'hindu',
            'buddhist',
            'sikh',
            'atheist',
            'agnostic',
            'other',
            'prefer-not-to-say'
        ]
    },
    languages: [{
        language: String,
        proficiency: {
            type: String,
            enum: ['basic', 'conversational', 'fluent', 'native']
        }
    }],
    interests: [{
        type: String,
        maxlength: 50
    }],
    hobbies: [{
        type: String,
        maxlength: 50
    }],
    lifestyle: {
        smoking: {
            type: String,
            enum: ['never', 'socially', 'regularly', 'prefer-not-to-say']
        },
        drinking: {
            type: String,
            enum: ['never', 'socially', 'regularly', 'prefer-not-to-say']
        },
        exercise: {
            type: String,
            enum: ['never', 'sometimes', 'regularly', 'daily']
        },
        diet: {
            type: String,
            enum: ['omnivore', 'vegetarian', 'vegan', 'pescatarian', 'kosher', 'halal', 'other']
        }
    },
    relationshipGoals: {
        type: String,
        enum: ['casual', 'serious', 'marriage', 'friendship', 'not-sure'],
        required: true
    },
    hasChildren: {
        type: String,
        enum: ['yes', 'no', 'prefer-not-to-say']
    },
    wantChildren: {
        type: String,
        enum: ['yes', 'no', 'maybe', 'prefer-not-to-say']
    },
    politicalViews: {
        type: String,
        enum: ['liberal', 'moderate', 'conservative', 'libertarian', 'green', 'other', 'prefer-not-to-say']
    },
    personalityTraits: [{
        trait: String,
        intensity: {
            type: Number,
            min: 1,
            max: 5
        }
    }],
    favoriteQuotes: [{
        quote: String,
        author: String
    }],
    travelHistory: [{
        country: String,
        city: String,
        year: Number,
        description: String
    }],
    bucketList: [String],
    dealBreakers: [String],
    funFacts: [String],
    profileCompletion: {
        type: Number,
        default: 0,
        min: 0,
        max: 100
    },
    verification: {
        isPhotoVerified: {
            type: Boolean,
            default: false
        },
        verificationPhotos: [String],
        verifiedAt: Date,
        verifiedBy: String
    },
    privacy: {
        showAge: {
            type: Boolean,
            default: true
        },
        showDistance: {
            type: Boolean,
            default: true
        },
        showOnline: {
            type: Boolean,
            default: true
        },
        showRecentlyActive: {
            type: Boolean,
            default: true
        }
    }
}, {
    timestamps: true,
    toJSON: { virtuals: true },
    toObject: { virtuals: true }
});

// Calculate profile completion percentage
profileSchema.methods.calculateCompletion = function() {
    let score = 0;
    const maxScore = 100;
    
    // Basic info (30 points)
    if (this.bio) score += 10;
    if (this.occupation.job) score += 5;
    if (this.education.school) score += 5;
    if (this.height) score += 5;
    if (this.relationshipGoals) score += 5;
    
    // Lifestyle (20 points)
    if (this.lifestyle.smoking) score += 5;
    if (this.lifestyle.drinking) score += 5;
    if (this.lifestyle.exercise) score += 5;
    if (this.lifestyle.diet) score += 5;
    
    // Personal info (30 points)
    if (this.interests && this.interests.length > 0) score += 10;
    if (this.hobbies && this.hobbies.length > 0) score += 10;
    if (this.languages && this.languages.length > 0) score += 5;
    if (this.personalityTraits && this.personalityTraits.length > 0) score += 5;
    
    // Additional info (20 points)
    if (this.favoriteQuotes && this.favoriteQuotes.length > 0) score += 5;
    if (this.travelHistory && this.travelHistory.length > 0) score += 5;
    if (this.bucketList && this.bucketList.length > 0) score += 5;
    if (this.funFacts && this.funFacts.length > 0) score += 5;
    
    this.profileCompletion = Math.min(score, maxScore);
    return this.profileCompletion;
};

// Update profile completion before saving
profileSchema.pre('save', function(next) {
    this.calculateCompletion();
    next();
});

// Static method to get profiles for matching
profileSchema.statics.getMatchingProfiles = function(userId, preferences) {
    const query = {
        user: { $ne: userId }
    };
    
    // Add age filter if specified
    if (preferences.ageRange) {
        // This would require calculating age from user's dateOfBirth
        // Implementation depends on how you want to handle this
    }
    
    // Add other matching criteria
    if (preferences.relationshipGoals) {
        query.relationshipGoals = { $in: preferences.relationshipGoals };
    }
    
    return this.find(query).populate('user', 'firstName age location profileImages');
};

// Index for efficient querying
profileSchema.index({ user: 1 });
profileSchema.index({ relationshipGoals: 1 });
profileSchema.index({ 'lifestyle.smoking': 1 });
profileSchema.index({ 'lifestyle.drinking': 1 });
profileSchema.index({ interests: 1 });

module.exports = mongoose.model('Profile', profileSchema);