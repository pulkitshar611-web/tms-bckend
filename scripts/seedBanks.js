const mongoose = require('mongoose');
const dotenv = require('dotenv');
const Bank = require('../models/Bank');

// Load env vars
dotenv.config();

const seedBanks = async () => {
    try {
        // Connect to database
        await mongoose.connect(process.env.MONGO_URI);
        console.log('MongoDB Connected...');

        // Check if banks already exist
        const existingBanks = await Bank.countDocuments();
        if (existingBanks > 0) {
            console.log(`${existingBanks} banks already exist in the database.`);
            console.log('Skipping seed. Delete existing banks first if you want to re-seed.');
            process.exit(0);
        }

        // Banks to seed
        const banks = [
            { name: 'HDFC Bank' },
            { name: 'ICICI Bank' },
            { name: 'State Bank of India' },
            { name: 'Axis Bank' },
            { name: 'Kotak Mahindra Bank' },
            { name: 'Punjab National Bank' },
            { name: 'Bank of Baroda' },
            { name: 'Canara Bank' }
        ];

        // Insert banks
        const createdBanks = await Bank.insertMany(banks);
        console.log(`✓ Successfully seeded ${createdBanks.length} banks:`);
        createdBanks.forEach(bank => {
            console.log(`  - ${bank.name}`);
        });

        process.exit(0);
    } catch (error) {
        console.error('Error seeding banks:', error);
        process.exit(1);
    }
};

seedBanks();
