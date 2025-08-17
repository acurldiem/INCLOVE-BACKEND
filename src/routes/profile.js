const express = require('express');
const Profile = require('../models/Profile');
const User = require('../models/User');
const { protect, requireEmailVerification } = require('../middleware/authMiddleware');

const router = express.Router();

// @desc    Get current user's profile
// @route   GET /api/profile/me
// @access  Private
router.get('/me', protect, async (req, res) => {
    try {
        let profile = await Profile.findOne({ user: req.user.id })
            .populate('user', 'firstName lastName email profileImages age');

        if (!profile) {
            // Create empty profile if doesn't exist
            profile = await Profile.create({ user: req.user.id });
            await profile.populate('user', 'firstName lastName email profileImages age');
        }

        res.status(200).json({
            success: true,
            data: { profile }
        });

    } catch (error) {
        console.error('Get profile error:', error);
        res.status(500).json({
            success: false,
            message: 'Server error'
        });
    }
});

// @desc    Get profile by user ID
// @route   GET /api/profile/user/:userId
// @access  Private
router.get('/user/:userId', protect, async (req, res) => {
    try {
        const profile = await Profile.findOne({ user: req.params.userId })
            .populate('user', 'firstName lastName profileImages age location lastActive');

        if (!profile) {
            return res.status(404).json({
                success: false,
                message: 'Profile not found'
            });
        }

        // Check privacy settings
        const user = await User.findById(req.params.userId);
        if (!user.isActive) {
            return res.status(404).json({
                success: false,
                message: 'User not found'
            });
        }

        // Remove sensitive information based on privacy settings
        const publicProfile = profile.toObject();
        
        if (!profile.privacy.showAge) {
            delete publicProfile.user.age;
        }
        
        if (!profile.privacy.showDistance) {
            delete publicProfile.user.location;
        }
        
        if (!profile.privacy.showRecentlyActive) {
            delete publicProfile.user.lastActive;
        }

        res.status(200).json({
            success: true,
            data: { profile: publicProfile }
        });

    } catch (error) {
        console.error('Get profile by ID error:', error);
        res.status(500).json({
            success: false,
            message: 'Server error'
        });
    }
});

// @desc    Create or update profile
// @route   PUT /api/profile
// @access  Private
router.put('/', protect, requireEmailVerification, async (req, res) => {
    try {
        const updateFields = { ...req.body };
        delete updateFields.user; // Prevent user field from being updated
        delete updateFields.profileCompletion; // This is calculated automatically

        let profile = await Profile.findOne({ user: req.user.id });

        if (!profile) {
            profile = await Profile.create({
                user: req.user.id,
                ...updateFields
            });
        } else {
            profile = await Profile.findOneAndUpdate(
                { user: req.user.id },
                updateFields,
                {
                    new: true,
                    runValidators: true,
                    upsert: true
                }
            );
        }

        await profile.populate('user', 'firstName lastName email profileImages age');

        res.status(200).json({
            success: true,
            message: 'Profile updated successfully',
            data: { profile }
        });

    } catch (error) {
        console.error('Update profile error:', error);
        res.status(500).json({
            success: false,
            message: 'Server error'
        });
    }
});

// @desc    Update basic info
// @route   PUT /api/profile/basic
// @access  Private
router.put('/basic', protect, async (req, res) => {
    try {
        const { bio, occupation, education, height, bodyType } = req.body;

        const updateFields = {};
        if (bio !== undefined) updateFields.bio = bio;
        if (occupation !== undefined) updateFields.occupation = occupation;
        if (education !== undefined) updateFields.education = education;
        if (height !== undefined) updateFields.height = height;
        if (bodyType !== undefined) updateFields.bodyType = bodyType;

        const profile = await Profile.findOneAndUpdate(
            { user: req.user.id },
            updateFields,
            { new: true, runValidators: true, upsert: true }
        ).populate('user', 'firstName lastName profileImages age');

        res.status(200).json({
            success: true,
            message: 'Basic info updated successfully',
            data: { profile }
        });

    } catch (error) {
        console.error('Update basic info error:', error);
        res.status(500).json({
            success: false,
            message: 'Server error'
        });
    }
});

// @desc    Update interests and hobbies
// @route   PUT /api/profile/interests
// @access  Private
router.put('/interests', protect, async (req, res) => {
    try {
        const { interests, hobbies } = req.body;

        const updateFields = {};
        if (interests !== undefined) updateFields.interests = interests;
        if (hobbies !== undefined) updateFields.hobbies = hobbies;

        const profile = await Profile.findOneAndUpdate(
            { user: req.user.id },
            updateFields,
            { new: true, runValidators: true, upsert: true }
        ).populate('user', 'firstName lastName profileImages age');

        res.status(200).json({
            success: true,
            message: 'Interests updated successfully',
            data: { profile }
        });

    } catch (error) {
        console.error('Update interests error:', error);
        res.status(500).json({
            success: false,
            message: 'Server error'
        });
    }
});

// @desc    Update lifestyle preferences
// @route   PUT /api/profile/lifestyle
// @access  Private
router.put('/lifestyle', protect, async (req, res) => {
    try {
        const { lifestyle } = req.body;

        const profile = await Profile.findOneAndUpdate(
            { user: req.user.id },
            { lifestyle },
            { new: true, runValidators: true, upsert: true }
        ).populate('user', 'firstName lastName profileImages age');

        res.status(200).json({
            success: true,
            message: 'Lifestyle preferences updated successfully',
            data: { profile }
        });

    } catch (error) {
        console.error('Update lifestyle error:', error);
        res.status(500).json({
            success: false,
            message: 'Server error'
        });
    }
});

// @desc    Update privacy settings
// @route   PUT /api/profile/privacy
// @access  Private
router.put('/privacy', protect, async (req, res) => {
    try {
        const { privacy } = req.body;

        const profile = await Profile.findOneAndUpdate(
            { user: req.user.id },
            { privacy },
            { new: true, runValidators: true, upsert: true }
        ).populate('user', 'firstName lastName profileImages age');

        res.status(200).json({
            success: true,
            message: 'Privacy settings updated successfully',
            data: { profile }
        });

    } catch (error) {
        console.error('Update privacy error:', error);
        res.status(500).json({
            success: false,
            message: 'Server error'
        });
    }
});

// @desc    Add language
// @route   POST /api/profile/languages
// @access  Private
router.post('/languages', protect, async (req, res) => {
    try {
        const { language, proficiency } = req.body;

        if (!language || !proficiency) {
            return res.status(400).json({
                success: false,
                message: 'Language and proficiency are required'
            });
        }

        const profile = await Profile.findOne({ user: req.user.id });
        
        if (!profile) {
            return res.status(404).json({
                success: false,
                message: 'Profile not found'
            });
        }

        // Check if language already exists
        const existingLanguage = profile.languages.find(
            lang => lang.language.toLowerCase() === language.toLowerCase()
        );

        if (existingLanguage) {
            existingLanguage.proficiency = proficiency;
        } else {
            profile.languages.push({ language, proficiency });
        }

        await profile.save();
        await profile.populate('user', 'firstName lastName profileImages age');

        res.status(200).json({
            success: true,
            message: 'Language added successfully',
            data: { profile }
        });

    } catch (error) {
        console.error('Add language error:', error);
        res.status(500).json({
            success: false,
            message: 'Server error'
        });
    }
});

// @desc    Remove language
// @route   DELETE /api/profile/languages/:language
// @access  Private
router.delete('/languages/:language', protect, async (req, res) => {
    try {
        const profile = await Profile.findOne({ user: req.user.id });
        
        if (!profile) {
            return res.status(404).json({
                success: false,
                message: 'Profile not found'
            });
        }

        profile.languages = profile.languages.filter(
            lang => lang.language.toLowerCase() !== req.params.language.toLowerCase()
        );

        await profile.save();
        await profile.populate('user', 'firstName lastName profileImages age');

        res.status(200).json({
            success: true,
            message: 'Language removed successfully',
            data: { profile }
        });

    } catch (error) {
        console.error('Remove language error:', error);
        res.status(500).json({
            success: false,
            message: 'Server error'
        });
    }
});

// @desc    Get profile completion status
// @route   GET /api/profile/completion
// @access  Private
router.get('/completion', protect, async (req, res) => {
    try {
        const profile = await Profile.findOne({ user: req.user.id });
        
        if (!profile) {
            return res.status(200).json({
                success: true,
                data: { 
                    completionPercentage: 0,
                    missingFields: [
                        'bio', 'occupation', 'education', 'interests', 
                        'lifestyle', 'relationshipGoals'
                    ]
                }
            });
        }

        const missingFields = [];
        
        if (!profile.bio) missingFields.push('bio');
        if (!profile.occupation?.job) missingFields.push('occupation');
        if (!profile.education?.school) missingFields.push('education');
        if (!profile.interests?.length) missingFields.push('interests');
        if (!profile.lifestyle?.smoking) missingFields.push('lifestyle');
        if (!profile.relationshipGoals) missingFields.push('relationshipGoals');

        res.status(200).json({
            success: true,
            data: {
                completionPercentage: profile.profileCompletion,
                missingFields
            }
        });

    } catch (error) {
        console.error('Get completion status error:', error);
        res.status(500).json({
            success: false,
            message: 'Server error'
        });
    }
});

// @desc    Delete profile
// @route   DELETE /api/profile
// @access  Private
router.delete('/', protect, async (req, res) => {
    try {
        const profile = await Profile.findOne({ user: req.user.id });
        
        if (!profile) {
            return res.status(404).json({
                success: false,
                message: 'Profile not found'
            });
        }

        await Profile.findByIdAndDelete(profile._id);

        res.status(200).json({
            success: true,
            message: 'Profile deleted successfully'
        });

    } catch (error) {
        console.error('Delete profile error:', error);
        res.status(500).json({
            success: false,
            message: 'Server error'
        });
    }
});

module.exports = router;