app.get('/users', async (req, res) => {
  try {
    const filter = {};

    // Validate firstName and lastName (optional)
    if (req.query.firstName && typeof req.query.firstName !== 'string') {
      return res.status(400).json({ error: 'firstName must be a string.' });
    }
    if (req.query.lastName && typeof req.query.lastName !== 'string') {
      return res.status(400).json({ error: 'lastName must be a string.' });
    }

    // Validate and add community
    if (req.query.community && typeof req.query.community === 'string') {
      filter.community = { $regex: req.query.community, $options: 'i' };
    }

    // Age range; only add if age_min and age_max are valid numbers
    if (req.query.age_min || req.query.age_max) {
      filter.age = {};
      if (
        req.query.age_min &&
        !isNaN(Number(req.query.age_min))
      ) {
        filter.age.$gte = Number(req.query.age_min);
      } else if (req.query.age_min) {
        return res.status(400).json({ error: 'age_min must be a number.' });
      }
      if (
        req.query.age_max &&
        !isNaN(Number(req.query.age_max))
      ) {
        filter.age.$lte = Number(req.query.age_max);
      } else if (req.query.age_max) {
        return res.status(400).json({ error: 'age_max must be a number.' });
      }
    }

    // Interests filter, validate type
    if (req.query.interests && typeof req.query.interests === 'string') {
      const interestsArray = req.query.interests.split(',').map(i => i.trim());
      filter.interests = { $in: interestsArray };
    }

    // hasChildren filter: must be 'true' or 'false'
    if (req.query.hasChildren) {
      const childrenParam = req.query.hasChildren.toLowerCase();
      if (childrenParam === 'true') {
        filter.children = { $in: ['yes', 'maybe'] };
      } else if (childrenParam === 'false') {
        filter.children = 'no';
      } else {
        return res.status(400).json({ error: 'hasChildren must be true or false.' });
      }
    }

    // planFamily filter: must be 'yes', 'no', or 'maybe'
    if (req.query.planFamily) {
      const validOptions = ['yes', 'no', 'maybe'];
      const planOption = req.query.planFamily.toLowerCase();
      if (validOptions.includes(planOption)) {
        filter.planFamily = planOption;
      } else {
        return res.status(400).json({ error: 'planFamily must be yes, no, or maybe.' });
      }
    }

    // Fetch users with filter
    const users = await User.find(filter).exec();
    res.json(users);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});
