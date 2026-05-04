require('dotenv').config();
const mongoose = require('mongoose');

const QuestionSchema = new mongoose.Schema({
    category: Number,
    difficulty: String,
    question: String,
    correct_answer: String,
    incorrect_answers: [String]
});
const Question = mongoose.model('Question', QuestionSchema);

// Categories with no questions at all for certain difficulties — these need to be filled
// from the closest available fallback within the SAME category.
// Category map for reference:
// 20=Mythology, 25=Art, 26=Celebs, 27=Animals, 13=Theatre, 30=Gadgets

// The real fix: improve server-side fetchQuestionsFromDB so it gracefully
// handles missing combos without silently serving wrong-difficulty questions.

async function auditAndReport() {
    try {
        await mongoose.connect(process.env.MONGO_URI, { serverSelectionTimeoutMS: 8000 });
        console.log('Connected to MongoDB\n');

        // Show per-category breakdown for the problem categories
        const problemCats = [20, 25, 26, 27, 13, 30];
        console.log('Detail for problem categories:\n');
        for (const cat of problemCats) {
            const rows = await Question.aggregate([
                { $match: { category: cat } },
                { $group: { _id: '$difficulty', count: { $sum: 1 } } }
            ]);
            if (rows.length === 0) {
                console.log(`  Category ${cat}: NO QUESTIONS AT ALL`);
            } else {
                const parts = rows.map(r => `${r._id}:${r.count}`).join(', ');
                console.log(`  Category ${cat}: ${parts}`);
            }
        }
    } catch (e) {
        console.error(e.message);
    } finally {
        await mongoose.disconnect();
    }
}
auditAndReport();
