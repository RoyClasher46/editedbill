const express = require("express");
const router = express.Router();
const mongoose = require("mongoose");
const Bill = require("../models/Bill");
const Counter = require("../models/Counter");
const Store = require("../models/Store");
const Payment = require("../models/Payment");

const getNextBillNumber = async () => {
  const counter = await Counter.findOneAndUpdate(
    { name: "bill" },
    { $inc: { seq: 1 } },
    { new: true, upsert: true }
  );
  return counter.seq;
};

// Create a new bill
router.post("/", async (req, res) => {
  try {
    console.log('POST /api/bills body:', JSON.stringify(req.body));

    const { storeId, storeName } = req.body;
    let billNumber = null;

    // accept either products or items from different clients
    const products = req.body.products || req.body.items || [];

    if (!Array.isArray(products) || products.length === 0) {
      return res.status(400).json({ error: 'No products provided. Include `products` (or `items`) array with at least one product.' });
    }

    // validation: require name and manual finalPrice per product
    for (const [i, p] of products.entries()) {
      if (!p.productName) {
        return res.status(400).json({ error: `Product at index ${i} is missing productName` });
      }
      if (p.finalPrice === undefined || isNaN(Number(p.finalPrice))) {
        return res.status(400).json({ error: `Product at index ${i} requires a valid finalPrice` });
      }
    }

    // resolve store
    let store = null;
    if (storeId) {
      if (!mongoose.Types.ObjectId.isValid(storeId)) {
        return res.status(400).json({ error: 'Invalid storeId' });
      }
      store = await Store.findById(storeId);
      if (!store) return res.status(404).json({ error: 'Store not found' });
    } else if (storeName) {
      store = await Store.findOne({ name: storeName.trim() });
      if (!store) {
        store = await Store.create({ name: storeName.trim() });
      }
    } else {
      return res.status(400).json({ error: 'Provide storeId or storeName' });
    }

    let grandTotal = 0;

    // determine bill number
    if (req.body.billNumber !== undefined && req.body.billNumber !== null && req.body.billNumber !== "") {
      const bn = Number(req.body.billNumber);
      if (!Number.isFinite(bn) || bn <= 0) {
        return res.status(400).json({ error: 'Invalid billNumber' });
      }
      // ensure uniqueness across all bills
      const exists = await Bill.findOne({ billNumber: bn });
      if (exists) return res.status(409).json({ error: 'Bill number already exists' });
      billNumber = bn;
    } else {
      billNumber = await getNextBillNumber();
    }

    const calculatedProducts = products.map(p => {
      const finalPrice = Number(p.finalPrice) || 0;
      const subtotal = finalPrice;
      grandTotal += finalPrice;

      return {
        productName: p.productName,
        productCode: p.productCode,
        quantity: p.quantity ? Number(p.quantity) : undefined,
        subtotal,
        finalPrice
      };
    });

    // paid amount is set after bill creation; default to 0 now
    const paidAmount = 0;
    const pendingAmount = Number((grandTotal - paidAmount).toFixed(2));

    const bill = new Bill({
      billNumber,
      store: store._id,
      products: calculatedProducts,
      grandTotal: Number(grandTotal.toFixed(2)),
      paidAmount: Number(paidAmount.toFixed(2)),
      pendingAmount
    });

    await bill.save();

    console.log('Saved bill:', bill._id ? bill._id.toString() : null, 'number', billNumber);
    res.status(201).json({ message: "Bill saved", bill });
  } catch (err) {
    console.error('Error saving bill:', err);
    res.status(500).json({ error: err.message });
  }
});

// Search bills by billNumber and/or storeId; if only storeId provided, return all bills for the store
router.get('/search', async (req, res) => {
  try {
    const { billNumber, storeId, date } = req.query;
    const filter = {};
    if (billNumber) filter.billNumber = Number(billNumber);
    if (storeId && mongoose.Types.ObjectId.isValid(storeId)) filter.store = storeId;

    // filter by a specific date (day) if provided
    if (date) {
      const d = new Date(date);
      if (isNaN(d.getTime())) return res.status(400).json({ error: 'Invalid date' });
      const start = new Date(d);
      start.setHours(0,0,0,0);
      const end = new Date(d);
      end.setHours(23,59,59,999);
      filter.date = { $gte: start, $lte: end };
    }

    const bills = await Bill.find(filter).populate('store', 'name');
    res.json({ bills });
  } catch (err) {
    console.error('Error searching bills:', err);
    res.status(500).json({ error: err.message });
  }
});

// Update paid amount of a bill
router.patch('/:id/paid', async (req, res) => {
  try {
    const { id } = req.params;
    if (!mongoose.Types.ObjectId.isValid(id)) return res.status(400).json({ error: 'Invalid bill id' });
    let { paidAmount } = req.body;
    paidAmount = Number(paidAmount);
    if (isNaN(paidAmount) || paidAmount < 0) return res.status(400).json({ error: 'Invalid paidAmount' });

    const bill = await Bill.findById(id);
    if (!bill) return res.status(404).json({ error: 'Bill not found' });

    if (paidAmount > bill.grandTotal) paidAmount = bill.grandTotal;
    const previousPaid = bill.paidAmount || 0;
    bill.paidAmount = Number(paidAmount.toFixed(2));
    bill.pendingAmount = Number((bill.grandTotal - bill.paidAmount).toFixed(2));
    await bill.save();

    // Log payment entry when paid amount changes (credit for increase, debit for decrease)
    const delta = Number((bill.paidAmount - previousPaid).toFixed(2));
    if (delta !== 0) {
      await Payment.create({
        bill: bill._id,
        store: bill.store,
        amount: delta, // can be negative for debit
        previousPaid: Number(previousPaid.toFixed(2)),
        newPaid: bill.paidAmount,
      });
    }

    res.json({ message: 'Paid amount updated', bill });
  } catch (err) {
    console.error('Error updating paid amount:', err);
    res.status(500).json({ error: err.message });
  }
});

// Update bill details (products, store, billNumber)
router.patch('/:id', async (req, res) => {
  try {
    const { id } = req.params;
    if (!mongoose.Types.ObjectId.isValid(id)) return res.status(400).json({ error: 'Invalid bill id' });
    const bill = await Bill.findById(id);
    if (!bill) return res.status(404).json({ error: 'Bill not found' });

    const { products, storeId, storeName, billNumber } = req.body;

    // update bill number if provided and different
    if (billNumber !== undefined && billNumber !== null && billNumber !== "") {
      const bn = Number(billNumber);
      if (!Number.isFinite(bn) || bn <= 0) {
        return res.status(400).json({ error: 'Invalid billNumber' });
      }
      if (bn !== bill.billNumber) {
        const exists = await Bill.findOne({ billNumber: bn });
        if (exists) return res.status(409).json({ error: 'Bill number already exists' });
        bill.billNumber = bn;
      }
    }

    // resolve store if provided
    if (storeId || storeName) {
      let store = null;
      if (storeId) {
        if (!mongoose.Types.ObjectId.isValid(storeId)) {
          return res.status(400).json({ error: 'Invalid storeId' });
        }
        store = await Store.findById(storeId);
        if (!store) return res.status(404).json({ error: 'Store not found' });
      } else if (storeName) {
        store = await Store.findOne({ name: storeName.trim() });
        if (!store) store = await Store.create({ name: storeName.trim() });
      }
      bill.store = store._id;
    }

    if (products) {
      if (!Array.isArray(products) || products.length === 0) {
        return res.status(400).json({ error: 'No products provided. Include `products` array with at least one product.' });
      }
      let grandTotal = 0;
      const calculatedProducts = [];

      for (const [i, p] of products.entries()) {
        if (!p.productName) return res.status(400).json({ error: `Product at index ${i} is missing productName` });
        if (p.finalPrice === undefined || isNaN(Number(p.finalPrice))) return res.status(400).json({ error: `Product at index ${i} requires a valid finalPrice` });
        const finalPrice = Number(p.finalPrice) || 0;
        const subtotal = finalPrice;
        grandTotal += finalPrice;
        calculatedProducts.push({
          productName: p.productName,
          productCode: p.productCode,
          quantity: p.quantity ? Number(p.quantity) : undefined,
          subtotal,
          finalPrice
        });
      }

      bill.products = calculatedProducts;
      bill.grandTotal = Number(grandTotal.toFixed(2));
      // ensure paidAmount not greater than grandTotal
      if (bill.paidAmount > bill.grandTotal) bill.paidAmount = bill.grandTotal;
      bill.pendingAmount = Number((bill.grandTotal - bill.paidAmount).toFixed(2));
    }

    await bill.save();
    const populated = await Bill.findById(bill._id).populate('store', 'name');
    res.json({ message: 'Bill updated', bill: populated });
  } catch (err) {
    console.error('Error updating bill:', err);
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
