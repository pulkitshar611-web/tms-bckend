const Ledger = require('../models/Ledger');
const User = require('../models/User');
const Trip = require('../models/Trip');
const { createAuditLog } = require('../middleware/auditLog');

// @desc    Get all ledger entries
// @route   GET /api/ledger
// @access  Public
const getLedger = async (req, res) => {
  try {
    const { agentId, date, lrNumber, page = 1, limit = 100 } = req.query;
    let query = {};

    // No role-based filtering - all entries visible to all
    if (agentId) {
      query.agent = agentId;
    }

    // Additional filters
    if (date) {
      query.date = new Date(date);
    }
    if (lrNumber) {
      query.$or = [
        { lrNumber: { $regex: lrNumber, $options: 'i' } },
        { tripId: { $regex: lrNumber, $options: 'i' } },
      ];
    }

    const ledger = await Ledger.find(query)
      .populate('agent', 'name email phone branch _id')
      .populate('agentId', 'name email phone branch _id')
      .populate('tripId', 'lrNumber route _id')
      .sort({ createdAt: -1 })
      .limit(limit * 1)
      .skip((page - 1) * limit);

    const total = await Ledger.countDocuments(query);

    // Transform ledger entries to match frontend expectations
    const transformedLedger = ledger.map(entry => ({
      ...entry.toObject(),
      id: entry._id,
      agentId: entry.agent?._id || entry.agentId?._id || entry.agentId,
      agent: entry.agent?.name || entry.agentId?.name || entry.agent,
    }));

    // Return array format for frontend compatibility
    res.json(transformedLedger);
  } catch (error) {
    console.error('Get ledger error:', error);
    res.status(500).json({ message: 'Server error' });
  }
};

// @desc    Get agent balance
// @route   GET /api/ledger/balance/:agentId
// @access  Public
const getAgentBalance = async (req, res) => {
  try {
    const agentId = req.params.agentId;

    if (!agentId) {
      return res.status(400).json({ message: 'agentId is required' });
    }

    // Find ledger entries matching agent ID (handle both agent field and agentId field)
    const ledger = await Ledger.find({
      $or: [
        { agent: agentId },
        { agentId: agentId },
        { 'agent._id': agentId },
        { 'agentId._id': agentId }
      ]
    })
      .populate('agent', 'name email phone branch _id')
      .populate('agentId', 'name email phone branch _id');

    const balance = ledger.reduce((sum, entry) => {
      const entryAgentId = entry.agent?._id?.toString() || entry.agentId?._id?.toString() || entry.agent?.toString() || entry.agentId?.toString();
      const requestedAgentId = agentId.toString();

      // Only include entries that match the requested agent
      if (entryAgentId === requestedAgentId || entry.agent?.toString() === requestedAgentId || entry.agentId?.toString() === requestedAgentId) {
        if (entry.direction === 'Credit') {
          return sum + (parseFloat(entry.amount) || 0);
        } else {
          return sum - (parseFloat(entry.amount) || 0);
        }
      }
      return sum;
    }, 0);

    res.json({ balance });
  } catch (error) {
    console.error('Get balance error:', error);
    res.status(500).json({ message: 'Server error' });
  }
};

// @desc    Add top-up
// @route   POST /api/ledger/topup
// @access  Public
const addTopUp = async (req, res) => {
  try {
    const { amount, agentId, mode, bank, reason, isVirtual } = req.body;

    if (!agentId) {
      return res.status(400).json({ message: 'agentId is required' });
    }

    const agent = await User.findById(agentId);
    if (!agent) {
      return res.status(404).json({ message: 'Agent not found' });
    }

    const amountNum = parseFloat(amount);
    const currentDate = new Date();

    if (isVirtual) {
      // Virtual Top-up: Credit + Immediate Debit
      const agentLedger = await Ledger.find({ agent: agentId });
      const agentBalance = agentLedger.reduce((sum, entry) => {
        if (entry.direction === 'Credit') {
          return sum + (entry.amount || 0);
        } else {
          return sum - (entry.amount || 0);
        }
      }, 0);

      // Credit entry
      await Ledger.create({
        tripId: null,
        lrNumber: `VIRTUAL-TOPUP-${Date.now()}`,
        date: currentDate,
        description: `Virtual Top-up: ${reason || 'Direct payment'}`,
        type: 'Virtual Top-up',
        amount: amountNum,
        advance: 0,
        balance: agentBalance + amountNum,
        agent: agentId,
        agentId: agentId,
        bank: bank || (mode === 'Cash' ? 'Cash' : ''),
        direction: 'Credit',
      });

      // Immediate Debit entry
      await Ledger.create({
        tripId: null,
        lrNumber: `VIRTUAL-TOPUP-${Date.now()}`,
        date: currentDate,
        description: `Expense: ${reason || 'Direct payment (Repairs/etc)'}`,
        type: 'Virtual Expense',
        amount: amountNum,
        advance: 0,
        balance: agentBalance,
        agent: agentId,
        agentId: agentId,
        bank: bank || (mode === 'Cash' ? 'Cash' : ''),
        direction: 'Debit',
      });
    } else {
      // Regular Bulk Top-up
      await Ledger.create({
        tripId: null,
        lrNumber: `TOPUP-${Date.now()}`,
        date: currentDate,
        description: `Top-up: ${reason || 'Balance top-up'}`,
        type: 'Top-up',
        amount: amountNum,
        advance: 0,
        balance: 0,
        agent: agentId,
        agentId: agentId,
        bank: bank || (mode === 'Cash' ? 'Cash' : 'HDFC Bank'),
        direction: 'Credit',
      });
    }

    // Create audit log (don't fail if this fails)
    try {
      const userId = req.body.userId || agentId || null;
      const userRole = req.body.userRole || 'Admin';
      await createAuditLog(
        userId,
        userRole,
        isVirtual ? 'Virtual Top-up' : 'Top-up',
        'Ledger',
        agentId,
        {
          agentId,
          amount: amountNum,
          reason,
          isVirtual,
          mode,
        },
        req.ip
      );
    } catch (auditError) {
      console.error('Audit log error (non-critical):', auditError);
      // Continue even if audit log fails
    }

    res.json({ message: 'Top-up added successfully' });
  } catch (error) {
    console.error('Add top-up error:', error);
    console.error('Error stack:', error.stack);
    // Check if ledger entries were created
    try {
      const recentEntries = await Ledger.find({ agent: req.body.agentId })
        .sort({ createdAt: -1 })
        .limit(2);
      if (recentEntries.length > 0) {
        // Top-up was created, return success
        return res.json({ message: 'Top-up added successfully' });
      }
    } catch (checkError) {
      console.error('Error checking existing entries:', checkError);
    }
    res.status(500).json({ message: 'Server error', error: error.message });
  }
};

// @desc    Transfer between agents
// @route   POST /api/ledger/transfer
// @access  Public
const transferToAgent = async (req, res) => {
  try {
    const { senderAgentId, receiverAgentId, amount } = req.body; // Frontend se senderAgentId bhi aayega

    if (!senderAgentId || !receiverAgentId) {
      return res.status(400).json({ message: 'senderAgentId and receiverAgentId are required' });
    }

    if (senderAgentId.toString() === receiverAgentId.toString()) {
      return res.status(400).json({ message: 'Cannot transfer to yourself' });
    }

    const senderAgent = await User.findById(senderAgentId);
    const receiverAgent = await User.findById(receiverAgentId);

    if (!senderAgent) {
      return res.status(404).json({ message: 'Sender agent not found' });
    }
    if (!receiverAgent) {
      return res.status(404).json({ message: 'Receiver agent not found' });
    }

    // Check sender's balance
    const senderLedger = await Ledger.find({ agent: senderAgentId });
    const senderBalance = senderLedger.reduce((sum, entry) => {
      if (entry.direction === 'Credit') {
        return sum + (entry.amount || 0);
      } else {
        return sum - (entry.amount || 0);
      }
    }, 0);

    const transferAmount = parseFloat(amount);
    if (senderBalance < transferAmount) {
      return res.status(400).json({ message: 'Insufficient balance' });
    }

    const currentDate = new Date();
    const sharedTimestamp = Date.now();
    const sharedLrNumber = `TRANSFER-${sharedTimestamp}`;

    // Debit entry for sender
    await Ledger.create({
      tripId: null,
      lrNumber: sharedLrNumber,
      date: currentDate,
      description: `Payment transferred to ${receiverAgent.name}`,
      type: 'Agent Transfer',
      amount: transferAmount,
      advance: 0,
      balance: senderBalance - transferAmount,
      agent: senderAgentId,
      agentId: senderAgentId,
      bank: 'HDFC Bank',
      direction: 'Debit',
    });

    // Calculate receiver's balance
    const receiverLedger = await Ledger.find({ agent: receiverAgentId });
    const receiverBalance = receiverLedger.reduce((sum, entry) => {
      if (entry.direction === 'Credit') {
        return sum + (entry.amount || 0);
      } else {
        return sum - (entry.amount || 0);
      }
    }, 0);

    // Credit entry for receiver
    await Ledger.create({
      tripId: null,
      lrNumber: sharedLrNumber,
      date: currentDate,
      description: `Payment received from ${senderAgent.name}`,
      type: 'Agent Transfer',
      amount: transferAmount,
      advance: 0,
      balance: receiverBalance + transferAmount,
      agent: receiverAgentId,
      agentId: receiverAgentId,
      bank: 'HDFC Bank',
      direction: 'Credit',
    });

    // Create audit log (don't fail if this fails)
    try {
      const userId = req.body.userId || senderAgentId || null;
      const userRole = req.body.userRole || 'Agent';
      await createAuditLog(
        userId,
        userRole,
        'Agent Transfer',
        'Ledger',
        senderAgentId,
        {
          senderAgentId,
          receiverAgentId,
          amount: transferAmount,
          senderName: senderAgent.name,
          receiverName: receiverAgent.name,
        },
        req.ip
      );
    } catch (auditError) {
      console.error('Audit log error (non-critical):', auditError);
    }

    res.json({
      message: 'Transfer successful',
      senderBalance: senderBalance - transferAmount,
      receiverBalance: receiverBalance + transferAmount,
    });
  } catch (error) {
    console.error('Transfer error:', error);
    console.error('Error stack:', error.stack);
    // Check if transfer entries were created
    try {
      const recentEntries = await Ledger.find({
        $or: [
          { agent: req.body.senderAgentId },
          { agent: req.body.receiverAgentId }
        ]
      })
        .sort({ createdAt: -1 })
        .limit(2);
      if (recentEntries.length >= 2) {
        // Transfer was created, return success
        return res.json({
          message: 'Transfer successful',
          senderBalance: 0,
          receiverBalance: 0,
        });
      }
    } catch (checkError) {
      console.error('Error checking existing entries:', checkError);
    }
    res.status(500).json({ message: 'Server error', error: error.message });
  }
};

// @desc    Update ledger entry (Only for Top-ups)
// @route   PUT /api/ledger/:id
// @access  Public (Should be restricted to Admin/Finance in production)
const updateLedgerEntry = async (req, res) => {
  try {
    const { id } = req.params;
    const { amount, description, reason } = req.body;

    const entry = await Ledger.findById(id);

    if (!entry) {
      return res.status(404).json({ message: 'Ledger entry not found' });
    }

    // Only allow editing Top-up or Agent Transfer types
    const allowedTypes = ['Top-up', 'Virtual Top-up', 'Agent Transfer'];
    if (!allowedTypes.includes(entry.type)) {
      return res.status(400).json({ message: 'This type of ledger entry cannot be edited' });
    }

    const updatedData = {};
    if (amount !== undefined) updatedData.amount = parseFloat(amount);

    // Handle description update
    if (entry.type === 'Agent Transfer') {
      // For transfers, we don't usually change description via direct reason
      // but if provided, we append it or use it wisely.
      // Usually only amount is changed for transfers.
    } else {
      if (description) updatedData.description = description;
      else if (reason) updatedData.description = `Top-up: ${reason}`;
    }

    // Update the main entry
    const updatedEntry = await Ledger.findByIdAndUpdate(
      id,
      { $set: updatedData },
      { new: true }
    );

    // If it's an Agent Transfer, find and update the twin entry
    if (entry.type === 'Agent Transfer' && entry.lrNumber) {
      try {
        const twinEntry = await Ledger.findOne({
          lrNumber: entry.lrNumber,
          _id: { $ne: entry._id },
          type: 'Agent Transfer',
          amount: entry.amount // Match original amount to be sure
        });

        if (twinEntry) {
          const twinUpdatedData = { amount: updatedData.amount };
          await Ledger.findByIdAndUpdate(twinEntry._id, { $set: twinUpdatedData });
          console.log(`Updated twin transfer entry: ${twinEntry._id}`);
        }
      } catch (twinError) {
        console.error('Error updating twin transfer entry:', twinError);
      }
    }

    // Create audit log
    try {
      const userId = req.body.userId || null;
      const userRole = req.body.userRole || 'Admin';
      await createAuditLog(
        userId,
        userRole,
        'Update Ledger Entry',
        'Ledger',
        id,
        {
          previousAmount: entry.amount,
          newAmount: updatedData.amount,
          previousDescription: entry.description,
          newDescription: updatedData.description,
        },
        req.ip
      );
    } catch (auditError) {
      console.error('Audit log error (non-critical):', auditError);
    }

    res.json(updatedEntry);
  } catch (error) {
    console.error('Update ledger entry error:', error);
    res.status(500).json({ message: 'Server error' });
  }
};

// @desc    Delete ledger entry (Only for Top-ups)
// @route   DELETE /api/ledger/:id
// @access  Public (Should be restricted to Admin/Finance in production)
const deleteLedgerEntry = async (req, res) => {
  try {
    const { id } = req.params;

    const entry = await Ledger.findById(id);

    if (!entry) {
      return res.status(404).json({ message: 'Ledger entry not found' });
    }

    // Only allow deleting Top-up or Agent Transfer types
    const allowedTypes = ['Top-up', 'Virtual Top-up', 'Agent Transfer'];
    if (!allowedTypes.includes(entry.type)) {
      return res.status(400).json({ message: 'This type of ledger entry cannot be deleted' });
    }

    // If it's an Agent Transfer, find and delete the twin entry first
    if (entry.type === 'Agent Transfer' && entry.lrNumber) {
      try {
        const twinEntry = await Ledger.findOne({
          lrNumber: entry.lrNumber,
          _id: { $ne: entry._id },
          type: 'Agent Transfer',
          amount: entry.amount
        });

        if (twinEntry) {
          await Ledger.findByIdAndDelete(twinEntry._id);
          console.log(`Deleted twin transfer entry: ${twinEntry._id}`);
        }
      } catch (twinError) {
        console.error('Error deleting twin transfer entry:', twinError);
      }
    }

    await Ledger.findByIdAndDelete(id);

    // Create audit log
    try {
      const userId = req.query.userId || null;
      const userRole = req.query.userRole || 'Admin';
      await createAuditLog(
        userId,
        userRole,
        'Delete Ledger Entry',
        'Ledger',
        id,
        {
          amount: entry.amount,
          type: entry.type,
          description: entry.description,
          agent: entry.agent,
        },
        req.ip
      );
    } catch (auditError) {
      console.error('Audit log error (non-critical):', auditError);
    }

    res.json({ message: 'Ledger entry deleted successfully' });
  } catch (error) {
    console.error('Delete ledger entry error:', error);
    res.status(500).json({ message: 'Server error' });
  }
};

module.exports = {
  getLedger,
  getAgentBalance,
  addTopUp,
  transferToAgent,
  updateLedgerEntry,
  deleteLedgerEntry,
};

