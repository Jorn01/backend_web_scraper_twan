const express = require('express');
const fs = require('fs');
const app = express();

app.use(require('cors')());
app.get('/api', (req, res) => {
    try {
        const data = JSON.parse(fs.readFileSync('match_data.json', 'utf8'));
        res.json(data);
    } catch (error) {
        res.status(500).send('Error reading data');
    }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});
