const mongoose = require('mongoose');

// IMPORTANT: Replace <password> with your actual password!
// Notice I added "/duobrain" before the "?" to name your database!
const MONGO_URI = "mongodb+srv://duobrain_user:2pxKBzV2pEPXGsVS@duobraincluster.qfi09ao.mongodb.net/?appName=DuoBrainCluster";

// Define what a question looks like
const QuestionSchema = new mongoose.Schema({
    category: Number,
    difficulty: String,
    question: String,
    correct_answer: String,
    incorrect_answers: [String]
});

const Question = mongoose.model('Question', QuestionSchema);

async function seedDatabase() {
    try {
        await mongoose.connect(MONGO_URI);
        console.log("✅ Connected to MongoDB Atlas!");

        // We are fetching 50 General Knowledge questions (category=9)
        const categoryId = 9; 
        const url = `https://opentdb.com/api.php?amount=50&category=${categoryId}&type=multiple`;
        
        console.log(`Fetching from API...`);
        const response = await fetch(url);
        const data = await response.json();

        if (data.results && data.results.length > 0) {
            const formattedQuestions = data.results.map(q => ({
                category: categoryId,
                difficulty: q.difficulty,
                question: q.question,
                correct_answer: q.correct_answer,
                incorrect_answers: q.incorrect_answers
            }));

            // Save them to your database!
            await Question.insertMany(formattedQuestions);
            console.log(`🎉 Successfully saved ${formattedQuestions.length} questions to your database!`);
        } else {
            console.log("⚠️ API didn't return results. You might be rate-limited. Wait 5 seconds and try again.");
        }
    } catch (err) {
        console.error("❌ Error:", err);
    } finally {
        mongoose.disconnect();
        console.log("Disconnected. Run me again if you want more questions!");
    }
}

seedDatabase();