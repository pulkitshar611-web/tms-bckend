const Bank = require('../models/Bank');

// @desc    Get all active banks
// @route   GET /api/banks
// @access  Public (all authenticated users)
exports.getAllBanks = async (req, res) => {
    try {
        const banks = await Bank.find({ isActive: true })
            .sort({ name: 1 })
            .select('name isActive createdAt updatedAt');

        res.json({
            success: true,
            count: banks.length,
            data: banks
        });
    } catch (error) {
        console.error('Error fetching banks:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to fetch banks',
            error: error.message
        });
    }
};

// @desc    Create new bank
// @route   POST /api/banks
// @access  Admin only
exports.createBank = async (req, res) => {
    try {
        const { name } = req.body;

        if (!name || !name.trim()) {
            return res.status(400).json({
                success: false,
                message: 'Bank name is required'
            });
        }

        // Check if bank already exists (case-insensitive)
        const existingBank = await Bank.findOne({
            name: { $regex: new RegExp(`^${name.trim()}$`, 'i') }
        });

        if (existingBank) {
            return res.status(400).json({
                success: false,
                message: 'Bank with this name already exists'
            });
        }

        const bank = await Bank.create({
            name: name.trim()
        });

        res.status(201).json({
            success: true,
            message: 'Bank created successfully',
            data: bank
        });
    } catch (error) {
        console.error('Error creating bank:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to create bank',
            error: error.message
        });
    }
};

// @desc    Update bank
// @route   PUT /api/banks/:id
// @access  Admin only
exports.updateBank = async (req, res) => {
    try {
        const { id } = req.params;
        const { name } = req.body;

        if (!name || !name.trim()) {
            return res.status(400).json({
                success: false,
                message: 'Bank name is required'
            });
        }

        // Check if another bank with same name exists
        const existingBank = await Bank.findOne({
            _id: { $ne: id },
            name: { $regex: new RegExp(`^${name.trim()}$`, 'i') }
        });

        if (existingBank) {
            return res.status(400).json({
                success: false,
                message: 'Another bank with this name already exists'
            });
        }

        const bank = await Bank.findByIdAndUpdate(
            id,
            {
                name: name.trim(),
                updatedAt: Date.now()
            },
            { new: true, runValidators: true }
        );

        if (!bank) {
            return res.status(404).json({
                success: false,
                message: 'Bank not found'
            });
        }

        res.json({
            success: true,
            message: 'Bank updated successfully',
            data: bank
        });
    } catch (error) {
        console.error('Error updating bank:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to update bank',
            error: error.message
        });
    }
};

// @desc    Delete bank (soft delete)
// @route   DELETE /api/banks/:id
// @access  Admin only
exports.deleteBank = async (req, res) => {
    try {
        const { id } = req.params;

        const bank = await Bank.findByIdAndUpdate(
            id,
            {
                isActive: false,
                updatedAt: Date.now()
            },
            { new: true }
        );

        if (!bank) {
            return res.status(404).json({
                success: false,
                message: 'Bank not found'
            });
        }

        res.json({
            success: true,
            message: 'Bank deleted successfully',
            data: bank
        });
    } catch (error) {
        console.error('Error deleting bank:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to delete bank',
            error: error.message
        });
    }
};
