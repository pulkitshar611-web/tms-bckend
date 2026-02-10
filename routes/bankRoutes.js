const express = require('express');
const router = express.Router();
const {
    getAllBanks,
    createBank,
    updateBank,
    deleteBank
} = require('../controllers/bankController');
const { protect, authorize } = require('../middleware/auth');

// Public route - all authenticated users can view banks
router.get('/', protect, getAllBanks);

// Admin only routes
router.post('/', protect, authorize('Admin'), createBank);
router.put('/:id', protect, authorize('Admin'), updateBank);
router.delete('/:id', protect, authorize('Admin'), deleteBank);

module.exports = router;
