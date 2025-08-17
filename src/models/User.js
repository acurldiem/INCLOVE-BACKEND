const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');

const userSchema = new mongoose.Schema({
    firstName: {
        type: String,
        required: [true, 'First name is required'],
        trim: true,
        maxlength: [50, 'First name cannot exceed 50 characters']
    },
    lastName: {
        type: String,
        required: [true, 'Last name is required'],
        trim: true,
        maxlength: [50, 'Last name cannot exceed 50 characters']
    },
    email: {
        type: String,
        required: [true, 'Email is required'],
        unique: true,
        lowercase: true,
        trim: true,
        match: [
            /^\w+([.-]?\w+)*@\w+([.-]?\w+)*(\.\w{2,3})+$/,
            'Please provide a valid email'
        ]
    },
    password: {
        type: String,
        required: [true, 'Password is required'],
        minlength: [6, 'Password must be at least 6 characters'],
        select: false // Don't include password in queries by default
    },
    phoneNumber: {
        type: String,
        required: [true, 'Phone number is required'],
        unique: true,
        match: [/^[+]?[1-9][\d]{0,15}$/, 'Please provide a valid phone number']
    },
    dateOfBirth: {
        type: Date,
        required: [true, 'Date of birth is required']
    },
    gender: {
        type: String,
        required: [true, 'Gender is required'],
        enum: ['male', 'female', 'other']
    },
    interestedIn: {
        type: String,
        required: [true, 'Interest preference is required'],
        enum: ['male', 'female', 'both']
    },
    location: {
        type: {
            type: String,
            enum: ['Point'],
            default: 'Point'
        },
        coordinates: {
            type: [Number], // [longitude, latitude]
            required: [true, 'Location coordinates are required']
        },
        address: {
            type: String,
            required: [true, 'Address is required']
        },
        city: String,
        state: String,
        country: String
    },
    profileImages: [{
        url: String,
        isProfile: {
            type: Boolean,
            default: false
        }
    }],
    isVerified: {
        type: Boolean,
        default: false
    },
    isActive: {
        type: Boolean,
        default: true
    },
    lastActive: {
        type: Date,
        default: Date.now
    },
    preferences: {
        ageRange: {
            min: {
                type: Number,
                default: 18,
                min: 18
            },
            max: {
                type: Number,
                default: 50,
                max: 100
            }
        },
        maxDistance: {
            type: Number,
            default: 50, // in kilometers
            max: 500
        },
        showMe: {
            type: String,
            enum: ['everyone', 'verified_only'],
            default: 'everyone'
        }
    },
    subscription: {
        type: {
            type: String,
            enum: ['free', 'premium', 'gold'],
            default: 'free'
        },
        expiresAt: Date,
        features: [{
            type: String,
            enum: ['unlimited_likes', 'super_likes', 'boost', 'read_receipts', 'rewind']
        }]
    },
    socialLinks: {
        instagram: String,
        spotify: String,
        snapchat: String
    },
    blockedUsers: [{
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User'
    }],
    reportedUsers: [{
        user: {
            type: mongoose.Schema.Types.ObjectId,
            ref: 'User'
        },
        reason: String,
        date: {
            type: Date,
            default: Date.now
        }
    }],
    resetPasswordToken: String,
    resetPasswordExpire: Date,
    emailVerificationToken: String,
    emailVerificationExpire: Date
}, {
    timestamps: true,
    toJSON: { virtuals: true },
    toObject: { virtuals: true }
});

// Create geospatial index
userSchema.index({ location: '2dsphere' });

// Virtual for age calculation
userSchema.virtual('age').get(function() {
    return Math.floor((Date.now() - this.dateOfBirth) / (365.25 * 24 * 60 * 60 * 1000));
});

// Virtual for full name
userSchema.virtual('fullName').get(function() {
    return `${this.firstName} ${this.lastName}`;
});

// Hash password before saving
userSchema.pre('save', async function(next) {
    if (!this.isModified('password')) {
        next();
    }
    
    const salt = await bcrypt.genSalt(10);
    this.password = await bcrypt.hash(this.password, salt);
    next();
});

// Compare password method
userSchema.methods.matchPassword = async function(enteredPassword) {
    return await bcrypt.compare(enteredPassword, this.password);
};

// Generate JWT token
userSchema.methods.getSignedJwtToken = function() {
    return jwt.sign(
        { id: this._id },
        process.env.JWT_SECRET,
        { expiresIn: process.env.JWT_EXPIRE }
    );
};

// Update last active timestamp
userSchema.methods.updateLastActive = function() {
    this.lastActive = Date.now();
    return this.save({ validateBeforeSave: false });
};

// Get users within distance
userSchema.statics.findNearby = function(coordinates, maxDistance) {
    return this.find({
        location: {
            $near: {
                $geometry: {
                    type: 'Point',
                    coordinates: coordinates
                },
                $maxDistance: maxDistance * 1000 // Convert km to meters
            }
        }
    });
};

module.exports = mongoose.model('User', userSchema);