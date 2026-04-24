const mongoose = require('mongoose');

// IMPORTANT: Put your real password here!
const MONGO_URI = "mongodb+srv://duobrain_user:2pxKBzV2pEPXGsVS@duobraincluster.qfi09ao.mongodb.net/?appName=DuoBrainCluster";

const QuestionSchema = new mongoose.Schema({
    category: Number,
    difficulty: String,
    question: String,
    correct_answer: String,
    incorrect_answers: [String]
});
const Question = mongoose.model('Question', QuestionSchema);

// Every category ID your game uses
const categories = [17, 19, 12, 22, 23, 11, 15, 21, 20, 18, 31, 10, 14, 16, 29, 30, 25, 27, 9, 28, 24, 26, 13, 32];
const difficulties = ['easy', 'medium', 'hard'];

const delay = (ms) => new Promise(resolve => setTimeout(resolve, ms));

async function runUltimateSeeder() {
    try {
        await mongoose.connect(MONGO_URI);
        console.log("Connected to MongoDB Atlas!");
        console.log("Initiating Ultimate Seeder... This will take about 6 minutes.");

        let totalSaved = 0;

        for (let i = 0; i < categories.length; i++) {
            const catId = categories[i];
            
            for (let d = 0; d < difficulties.length; d++) {
                const diff = difficulties[d];
                console.log(`Fetching Category ${catId} | Difficulty: ${diff.toUpperCase()}...`);
                
                // We ask specifically for 50 questions of this exact difficulty
                const url = `https://opentdb.com/api.php?amount=50&category=${catId}&difficulty=${diff}&type=multiple`;
                
                const response = await fetch(url);
                const data = await response.json();

                if (data.results && data.results.length > 0) {
                    const formatted = data.results.map(q => ({
                        category: catId,
                        difficulty: q.difficulty,
                        question: q.question,
                        correct_answer: q.correct_answer,
                        incorrect_answers: q.incorrect_answers
                    }));

                    await Question.insertMany(formatted);
                    totalSaved += formatted.length;
                    console.log(`   Saved ${formatted.length} questions! (Total: ${totalSaved})`);
                } else {
                    // This happens if OpenTDB simply doesn't have enough questions for this niche
                    console.log(`   OpenTDB has NO ${diff.toUpperCase()} questions for Category ${catId}.`);
                }

                // Wait 5 seconds to prevent getting IP banned by OpenTDB
                await delay(5000); 
            }
        }

        console.log(`\n🏆 ULTIMATE SEEDER COMPLETE! Added ${totalSaved} new questions to your database.`);
    } catch (err) {
        console.error("❌ Error:", err);
    } finally {
        mongoose.disconnect();
    }
}

runUltimateSeeder();