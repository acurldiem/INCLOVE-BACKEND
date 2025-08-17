const express = require('express');
const User = require('../models/User');
const Profile = require('../models/Profile');
const Match = require('../models/Match');
const { protect, requirePremium } = require('../middleware/authMiddleware');

const router = express.Router();

// @desc    Get current user
// @route   GET /api/users/me
// @access  Private
router.get('/me', protect, async (req, res) => {
    try {
        const user = await User.findById(req.user.id);
        
        res.status(200).json({
            success: true,
            data: { user }
        });
    } catch (error) {
        console.error('Get current user error:', error);
        res.status(500).json({
            success: false,
            message: 'Server error'
        });
    }
});

// @desc    Update user preferences
// @route   PUT /api/users/preferences
// @access  Private
router.put('/preferences', protect, async (req, res) => {
    try {
        const { preferences } = req.body;

        // Validate age range
        if (preferences.ageRange) {
            if (preferences.ageRange.min < 18 || preferences.ageRange.max > 100) {
                return res.status(400).json({
                    success: false,
                    message: 'Age range must be between 18 and 100'
                });
            }
            
            if (preferences.ageRange.min >= preferences.ageRange.max) {
                return res.status(400).json({
                    success: false,
                    message: 'Minimum age must be less than maximum age'
                });
            }
        }

        // Validate max distance
        if (preferences.maxDistance && preferences.maxDistance > 500) {
            return res.status(400).json({
                success: false,
                message: 'Maximum distance cannot exceed 500km'
            });
        }

        const user = await User.findByIdAndUpdate(
            req.user.id,
            { preferences },
            { new: true, runValidators: true }
        );

        res.status(200).json({
            success: true,
            message: 'Preferences updated successfully',
            data: { user }
        });

    } catch (error) {
        console.error('Update preferences error:', error);
        res.status(500).json({
            success: false,
            message: 'Server error'
        });
    }
});

// @desc    Update location
// @route   PUT /api/users/location
// @access  Private
router.put('/location', protect, async (req, res) => {
    try {
        const { location } = req.body;

        if (!location || !location.coordinates || location.coordinates.length !== 2) {
            return res.status(400).json({
                success: false,
                message: 'Valid coordinates are required'
            });
        }

        const user = await User.findByIdAndUpdate(
            req.user.id,
            { 
                location: {
                    type: 'Point',
                    coordinates: location.coordinates,
                    address: location.address,
                    city: location.city,
                    state: location.state,
                    country: location.country
                }
            },
            { new: true, runValidators: true }
        );

        res.status(200).json({
            success: true,
            message: 'Location updated successfully',
            data: { user }
        });

    } catch (error) {
        console.error('Update location error:', error);
        res.status(500).json({
            success: false,
            message: 'Server error'
        });
    }
});

// @desc    Get potential matches
// @route   GET /api/users/discover
// @access  Private
router.get('/discover', protect, async (req, res) => {
    try {
        const currentUser = req.user;
        const { page = 1, limit = 10 } = req.query;
        
        // Get users the current user has already interacted with
        const excludeUserIds = await Match.getPotentialMatches(currentUser.id);

        // Build match query
        const matchQuery = {
            _id: { $nin: excludeUserIds },
            isActive: true,
            isVerified: currentUser.preferences.showMe === 'verified_only' ? true : { $ne: false }
        };

        // Gender preference
        if (currentUser.interestedIn !== 'both') {
            matchQuery.gender = currentUser.interestedIn;
        }

        // Age preference
        const currentDate = new Date();
        const minBirthDate = new Date(currentDate.getFullYear() - currentUser.preferences.ageRange.max, 
                                    currentDate.getMonth(), currentDate.getDate());
        const maxBirthDate = new Date(currentDate.getFullYear() - currentUser.preferences.ageRange.min, 
                                    currentDate.getMonth(), currentDate.getDate());

        matchQuery.dateOfBirth = {
            $gte: minBirthDate,
            $lte: maxBirthDate
        };

        // Location-based filtering
        let potentialMatches = await User.findNearby(
            currentUser.location.coordinates,
            currentUser.preferences.maxDistance
        )
        .find(matchQuery)
        .select('firstName profileImages dateOfBirth location lastActive')
        .limit(parseInt(limit))
        .skip((parseInt(page) - 1) * parseInt(limit));

        // Get profiles for additional matching criteria
        const userIds = potentialMatches.map(user => user._id);
        const profiles = await Profile.find({ user: { $in: userIds } })
            .populate('user', 'firstName profileImages dateOfBirth location lastActive');

        // Calculate match scores and sort
        const matchesWithScores = await Promise.all(
            profiles.map(async (profile) => {
                // Find or create a temporary match to calculate score
                const tempMatch = new Match({
                    user1: currentUser.id,
                    user2: profile.user._id,
                    initiatedBy: currentUser.id,
                    matchType: 'like'
                });
                
                const score = await tempMatch.calculateMatchScore();
                
                return {
                    user: profile.user,
                    profile: profile,
                    matchScore: score,
                    distance: calculateDistance(
                        currentUser.location.coordinates,
                        profile.user.location.coordinates
                    )
                };
            })
        );

        // Sort by match score
        matchesWithScores.sort((a, b) => b.matchScore - a.matchScore);

        res.status(200).json({
            success: true,
            data: {
                matches: matchesWithScores,
                pagination: {
                    current: parseInt(page),
                    limit: parseInt(limit),
                    total: matchesWithScores.length
                }
            }
        });

    } catch (error) {
        console.error('Get discover users error:', error);
        res.status(500).json({
            success: false,
            message: 'Server error'
        });
    }
});

// @desc    Block user
// @route   PUT /api/users/block/:userId
// @access  Private
router.put('/block/:userId', protect, async (req, res) => {
    try {
        const userToBlock = req.params.userId;
        
        if (userToBlock === req.user.id.toString()) {
            return res.status(400).json({
                success: false,
                message: 'You cannot block yourself'
            });
        }

        const user = await User.findById(req.user.id);
        
        if (!user.blockedUsers.includes(userToBlock)) {
            user.blockedUsers.push(userToBlock);
            await user.save();

            // Create/update match with block action
            await Match.createMatch(req.user.id, userToBlock, 'block', req.user.id);
        }

        res.status(200).json({
            success: true,
            message: 'User blocked successfully'
        });

    } catch (error) {
        console.error('Block user error:', error);
        res.status(500).json({
            success: false,
            message: 'Server error'
        });
    }
});

// @desc    Unblock user
// @route   PUT /api/users/unblock/:userId
// @access  Private
router.put('/unblock/:userId', protect, async (req, res) => {
    try {
        const userToUnblock = req.params.userId;
        
        const user = await User.findById(req.user.id);
        user.blockedUsers = user.blockedUsers.filter(
            id => id.toString() !== userToUnblock
        );
        
        await user.save();

        res.status(200).json({
            success: true,
            message: 'User unblocked successfully'
        });

    } catch (error) {
        console.error('Unblock user error:', error);
        res.status(500).json({
            success: false,
            message: 'Server error'
        });
    }
});

// @desc    Report user
// @route   POST /api/users/report/:userId
// @access  Private
router.post('/report/:userId', protect, async (req, res) => {
    try {
        const userToReport = req.params.userId;
        const { reason } = req.body;

        if (userToReport === req.user.id.toString()) {
            return res.status(400).json({
                success: false,
                message: 'You cannot report yourself'
            });
        }

        if (!reason) {
            return res.status(400).json({
                success: false,
                message: 'Report reason is required'
            });
        }

        const user = await User.findById(req.user.id);
        
        // Check if already reported
        const existingReport = user.reportedUsers.find(
            report => report.user.toString() === userToReport
        );

        if (existingReport) {
            return res.status(400).json({
                success: false,
                message: 'User already reported'
            });
        }

        user.reportedUsers.push({
            user: userToReport,
            reason: reason
        });

        await user.save();

        res.status(200).json({
            success: true,
            message: 'User reported successfully'
        });

    } catch (error) {
        console.error('Report user error:', error);
        res.status(500).json({
            success: false,
            message: 'Server error'
        });
    }
});

// @desc    Get blocked users
// @route   GET /api/users/blocked
// @access  Private
router.get('/blocked', protect, async (req, res) => {
    try {
        const user = await User.findById(req.user.id)
            .populate('blockedUsers', 'firstName profileImages');

        res.status(200).json({
            success: true,
            data: { blockedUsers: user.blockedUsers }
        });

    } catch (error) {
        console.error('Get blocked users error:', error);
        res.status(500).json({
            success: false,
            message: 'Server error'
        });
    }
});

// @desc    Search users (premium feature)
// @route   GET /api/users/search
// @access  Private (Premium)
router.get('/search', protect, requirePremium('search'), async (req, res) => {
    try {
        const { 
            name, 
            age, 
            location, 
            interests, 
            occupation,
            education,
            page = 1, 
            limit = 20 
        } = req.query;

        const searchQuery = {
            _id: { $ne: req.user.id },
            isActive: true
        };

        // Build search criteria
        const profiles = await Profile.find({})
            .populate({
                path: 'user',
                match: searchQuery,
                select: 'firstName lastName profileImages dateOfBirth location lastActive'
            })
            .where('user').ne(null);

        let filteredProfiles = profiles;

        // Filter by name
        if (name) {
            filteredProfiles = filteredProfiles.filter(profile => 
                profile.user.firstName.toLowerCase().includes(name.toLowerCase()) ||
                profile.user.lastName.toLowerCase().includes(name.toLowerCase())
            );
        }

        // Filter by age
        if (age) {
            const [minAge, maxAge] = age.split('-').map(Number);
            filteredProfiles = filteredProfiles.filter(profile => {
                const userAge = profile.user.age;
                return userAge >= minAge && userAge <= maxAge;
            });
        }

        // Filter by interests
        if (interests) {
            const searchInterests = interests.split(',').map(i => i.trim().toLowerCase());
            filteredProfiles = filteredProfiles.filter(profile =>
                profile.interests.some(interest => 
                    searchInterests.some(searchInterest => 
                        interest.toLowerCase().includes(searchInterest)
                    )
                )
            );
        }

        // Filter by occupation
        if (occupation) {
            filteredProfiles = filteredProfiles.filter(profile =>
                profile.occupation.job && 
                profile.occupation.job.toLowerCase().includes(occupation.toLowerCase())
            );
        }

        // Filter by education
        if (education) {
            filteredProfiles = filteredProfiles.filter(profile =>
                profile.education.school && 
                profile.education.school.toLowerCase().includes(education.toLowerCase())
            );
        }

        // Pagination
        const startIndex = (page - 1) * limit;
        const endIndex = page * limit;
        const paginatedResults = filteredProfiles.slice(startIndex, endIndex);

        res.status(200).json({
            success: true,
            data: {
                users: paginatedResults,
                pagination: {
                    current: parseInt(page),
                    limit: parseInt(limit),
                    total: filteredProfiles.length,
                    pages: Math.ceil(filteredProfiles.length / limit)
                }
            }
        });

    } catch (error) {
        console.error('Search users error:', error);
        res.status(500).json({
            success: false,
            message: 'Server error'
        });
    }
});

// @desc    Upload profile images
// @route   POST /api/users/upload-images
// @access  Private
router.post('/upload-images', protect, async (req, res) => {
    try {
        // This would typically handle file upload using multer
        // For now, we'll accept image URLs
        const { images } = req.body;

        if (!images || !Array.isArray(images)) {
            return res.status(400).json({
                success: false,
                message: 'Images array is required'
            });
        }

        if (images.length > 6) {
            return res.status(400).json({
                success: false,
                message: 'Maximum 6 images allowed'
            });
        }

        const profileImages = images.map((image, index) => ({
            url: image.url,
            isProfile: index === 0 // First image is profile picture
        }));

        const user = await User.findByIdAndUpdate(
            req.user.id,
            { profileImages },
            { new: true, runValidators: true }
        );

        res.status(200).json({
            success: true,
            message: 'Images uploaded successfully',
            data: { user }
        });

    } catch (error) {
        console.error('Upload images error:', error);
        res.status(500).json({
            success: false,
            message: 'Server error'
        });
    }
});

// @desc    Delete profile image
// @route   DELETE /api/users/images/:imageIndex
// @access  Private
router.delete('/images/:imageIndex', protect, async (req, res) => {
    try {
        const imageIndex = parseInt(req.params.imageIndex);
        const user = await User.findById(req.user.id);

        if (imageIndex < 0 || imageIndex >= user.profileImages.length) {
            return res.status(400).json({
                success: false,
                message: 'Invalid image index'
            });
        }

        user.profileImages.splice(imageIndex, 1);
        
        // If deleted image was profile picture, make first image profile
        if (user.profileImages.length > 0) {
            user.profileImages[0].isProfile = true;
        }

        await user.save();

        res.status(200).json({
            success: true,
            message: 'Image deleted successfully',
            data: { user }
        });

    } catch (error) {
        console.error('Delete image error:', error);
        res.status(500).json({
            success: false,
            message: 'Server error'
        });
    }
});

// @desc    Set profile picture
// @route   PUT /api/users/profile-picture/:imageIndex
// @access  Private
router.put('/profile-picture/:imageIndex', protect, async (req, res) => {
    try {
        const imageIndex = parseInt(req.params.imageIndex);
        const user = await User.findById(req.user.id);

        if (imageIndex < 0 || imageIndex >= user.profileImages.length) {
            return res.status(400).json({
                success: false,
                message: 'Invalid image index'
            });
        }

        // Reset all images to not profile
        user.profileImages.forEach(image => {
            image.isProfile = false;
        });

        // Set selected image as profile
        user.profileImages[imageIndex].isProfile = true;

        await user.save();

        res.status(200).json({
            success: true,
            message: 'Profile picture updated successfully',
            data: { user }
        });

    } catch (error) {
        console.error('Set profile picture error:', error);
        res.status(500).json({
            success: false,
            message: 'Server error'
        });
    }
});

// @desc    Get user statistics
// @route   GET /api/users/stats
// @access  Private
router.get('/stats', protect, async (req, res) => {
    try {
        const userId = req.user.id;

        // Get match statistics
        const totalMatches = await Match.countDocuments({
            $or: [{ user1: userId }, { user2: userId }],
            status: 'matched'
        });

        const pendingMatches = await Match.countDocuments({
            $or: [{ user1: userId }, { user2: userId }],
            status: 'pending'
        });

        // Get profile views (this would require a separate collection in real app)
        const profileViews = 0; // Placeholder

        // Get likes given and received
        const likesGiven = await Match.countDocuments({
            initiatedBy: userId,
            'interactions.action': { $in: ['like', 'super_like'] }
        });

        const likesReceived = await Match.countDocuments({
            $or: [{ user1: userId }, { user2: userId }],
            initiatedBy: { $ne: userId },
            'interactions.action': { $in: ['like', 'super_like'] }
        });

        res.status(200).json({
            success: true,
            data: {
                matches: totalMatches,
                pendingMatches,
                profileViews,
                likesGiven,
                likesReceived,
                matchRate: likesGiven > 0 ? ((totalMatches / likesGiven) * 100).toFixed(1) : 0
            }
        });

    } catch (error) {
        console.error('Get user stats error:', error);
        res.status(500).json({
            success: false,
            message: 'Server error'
        });
    }
});

// Helper function to calculate distance between two coordinates
function calculateDistance(coords1, coords2) {
    const [lon1, lat1] = coords1;
    const [lon2, lat2] = coords2;
    
    const R = 6371; // Earth's radius in kilometers
    const dLat = toRad(lat2 - lat1);
    const dLon = toRad(lon2 - lon1);
    
    const a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
              Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) *
              Math.sin(dLon / 2) * Math.sin(dLon / 2);
    
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    return Math.round(R * c);
}

function toRad(degree) {
    return degree * (Math.PI / 180);
}

module.exports = router;