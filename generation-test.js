const fs = require('fs').promises;

let transcript_file = process.argv[2];
let entities_file = process.argv[3];
let sen_count = process.argv[4];

generateSummary(transcript_file, entities_file, sen_count);

async function generateSummary(transcript_file, entities_file, sen_count = 0) {
    let sentences = await fs.readFile(transcript_file, 'utf8');
    sentences = sentences.replace(/([.?!])\s*(?=[A-Z])/g, "$1|").split("|");
    
    let entities = await fs.readFile(entities_file, 'utf8');
    entities = JSON.parse(entities);
    
    let key_words = Array.from(entities.Entities, (element) => {
        return element.Text;
    });

    key_words = [...new Set(key_words)];

    let summary = [];

    for (i = 0; i < sen_count; i++){
        let entity = key_words.shift();
        for(j = 0; j < sentences.length; j++) {
            if (sentences[j].includes(entity)){
                summary.push(sentences[j]);
                sentences.splice(j,1);
                break;
            }
        }
    }

    console.log(summary.join(' ').trim());
}