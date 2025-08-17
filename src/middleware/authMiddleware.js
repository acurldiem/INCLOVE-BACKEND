const jwt = require('jsonwebtoken');
const User = require('../models/User');

// Protect routes - requires authentication
exports.protect = async (req, res, next) => {
    let token;

    // Check for token in Authorization header
    if (req.headers.authorization && req.headers.authorization.startsWith('Bearer')) {
        token = req.headers.authorization.split(' ')[1];
    }

    // Check if token exists
    if (!token) {
        return res.status(401).json({
            success: false,
            message: 'Access denied. No token provided.'
        });
    }

    try {
        // Verify token
        const decoded = jwt.verify(token, process.env.JWT_SECRET);

        // Get user from database
        const user = await User.findById(decoded.id);
        
        if (!user) {
            return res.status(401).json({
                success: false,
                message: 'No user found with this token'
            });
        }

        // Check if user is active
        if (!user.isActive) {
            return res.status(401).json({
                success: false,
                message: 'User account is deactivated'
            });
        }

        // Update last active
        user.updateLastActive();

        // Add user to request object
        req.user = user;
        next();
    } catch (error) {
        return res.status(401).json({
            success: false,
            message: 'Invalid token'
        });
    }
};

// Authorization middleware - check for specific roles/permissions
exports.authorize = (...roles) => {
    return (req, res, next) => {
        if (!req.user) {
            return res.status(401).json({
                success: false,
                message: 'Access denied'
            });
        }

        if (!roles.includes(req.user.role)) {
            return res.status(403).json({
                success: false,
                message: 'Access forbidden. Insufficient permissions.'
            });
        }

        next();
    };
};

// Optional authentication - doesn't require token but adds user if present
exports.optionalAuth = async (req, res, next) => {
    let token;

    if (req.headers.authorization && req.headers.authorization.startsWith('Bearer')) {
        token = req.headers.authorization.split(' ')[1];
    }

    if (token) {
        try {
            const decoded = jwt.verify(token, process.env.JWT_SECRET);
            const user = await User.findById(decoded.id);
            
            if (user && user.isActive) {
                req.user = user;
                user.updateLastActive();
            }
        } catch (error) {
            // Token invalid, but continue without user
            console.log('Invalid optional token:', error.message);
        }
    }

    next();
};

// Check if user owns the resource
exports.checkOwnership = (resourceModel, resourceParam = 'id') => {
    return async (req, res, next) => {
        try {
            const resource = await resourceModel.findById(req.params[resourceParam]);
            
            if (!resource) {
                return res.status(404).json({
                    success: false,
                    message: 'Resource not found'
                });
            }

            // Check if user owns the resource
            if (resource.user.toString() !== req.user._id.toString()) {
                return res.status(403).json({
                    success: false,
                    message: 'Access denied. You can only access your own resources.'
                });
            }

            req.resource = resource;
            next();
        } catch (error) {
            return res.status(500).json({
                success: false,
                message: 'Server error'
            });
        }
    };
};

// Rate limiting for specific actions
exports.rateLimitByUser = (maxRequests = 100, windowMs = 15 * 60 * 1000) => {
    const userRequests = new Map();

    return (req, res, next) => {
        if (!req.user) {
            return next();
        }

        const userId = req.user._id.toString();
        const now = Date.now();
        
        if (!userRequests.has(userId)) {
            userRequests.set(userId, { count: 1, resetTime: now + windowMs });
            return next();
        }

        const userRequest = userRequests.get(userId);
        
        if (now > userRequest.resetTime) {
            userRequest.count = 1;
            userRequest.resetTime = now + windowMs;
            return next();
        }

        if (userRequest.count >= maxRequests) {
            return res.status(429).json({
                success: false,
                message: 'Too many requests. Please try again later.',
                retryAfter: Math.ceil((userRequest.resetTime - now) / 1000)
            });
        }

        userRequest.count++;
        next();
    };
};

// Verify email middleware
exports.requireEmailVerification = (req, res, next) => {
    if (!req.user.isVerified) {
        return res.status(403).json({
            success: false,
            message: 'Please verify your email address first'
        });
    }
    next();
};

// Premium features middleware
exports.requirePremium = (feature) => {
    return (req, res, next) => {
        const user = req.user;
        
        if (user.subscription.type === 'free') {
            return res.status(403).json({
                success: false,
                message: 'This feature requires a premium subscription',
                feature: feature,
                upgradeRequired: true
            });
        }

        // Check if specific feature is available
        if (feature && !user.subscription.features.includes(feature)) {
            return res.status(403).json({
                success: false,
                message: `This feature (${feature}) is not included in your subscription`,
                feature: feature,
                upgradeRequired: true
            });
        }

        next();
    };
};