const express = require('express');
const Payment = require('../models/Payment');

const router = express.Router();

// List payments (most recent first)
// Optional query: limit (default 10)
router.get('/', async (req, res) => {
  try {
    const limit = Math.max(1, Math.min(100, Number(req.query.limit) || 10));
    const page = Math.max(1, Number(req.query.page) || 1);
    const { from, to } = req.query;
    const filter = {};
    const dateFilter = {};
    if (from) {
      const d = new Date(from);
      if (!isNaN(d.getTime())) {
        // treat `from` as start of day (inclusive)
        d.setHours(0,0,0,0);
        dateFilter.$gte = d;
      }
    }
    if (to) {
      const d = new Date(to);
      if (!isNaN(d.getTime())) {
        // treat `to` as end of day (inclusive)
        d.setHours(23,59,59,999);
        dateFilter.$lte = d;
      }
    }
    if (dateFilter.$gte || dateFilter.$lte) filter.date = dateFilter;

    const totalCount = await Payment.countDocuments(filter);
    // compute total amount for the filtered payments (use aggregate to sum amounts)
    const agg = await Payment.aggregate([
      { $match: filter },
      { $group: { _id: null, totalAmount: { $sum: '$amount' } } }
    ]);
    const totalAmount = (agg[0] && agg[0].totalAmount) ? agg[0].totalAmount : 0;

    const payments = await Payment.find(filter)
      .sort({ date: -1, createdAt: -1 })
      .skip((page - 1) * limit)
      .limit(limit)
      .populate('store', 'name')
      .populate('bill', 'billNumber');
    const totalPages = Math.max(1, Math.ceil(totalCount / limit));
    res.json({ payments, page, limit, totalCount, totalPages, totalAmount });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
