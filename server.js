const express = require('express');
const cors = require('cors');
const axios = require('axios');
require('dotenv').config();
const app = express();
const port = process.env.PORT || 3000;

// API endpoint for Europe PMC queries
app.post('/api/europepmc', async (req, res) => {
  try {
    const { query } = req.body;
    
    const response = await axios.get(`https://www.ebi.ac.uk/europepmc/webservices/rest/search?query=${encodeURIComponent(query)}&format=json&resultType=core`);
    
    if (!response.data?.resultList?.result) {
      throw new Error('Invalid response structure from Europe PMC API');
    }
    
    const results = response.data.resultList.result.map(item => ({
      title: item.title || 'No title',
      abstract: item.abstractText || 'No abstract available',
      authors: item.authorList?.author?.map(a => a.fullName) || ['No authors'],
      citations: item.citedByCount || 0,
      doi: item.doi || '',
      url: `https://europepmc.org/article/MED/${item.pmid}`
    }));
    
    res.json({ results });
  } catch (error) {
    console.error('Error:', error);
    res.status(500).json({ error: 'An error occurred while processing your Europe PMC request' });
  }
});

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.static('public'));

// API endpoint for Wikipedia queries
app.post('/api/wikipedia', async (req, res) => {
  try {
    const { query } = req.body;
    
    const searchResponse = await axios.get(`https://en.wikipedia.org/w/api.php?action=query&format=json&list=search&srsearch=${encodeURIComponent(query)}`);
    
    if (!searchResponse.data?.query?.search) {
      throw new Error('Invalid response structure from Wikipedia API');
    }
    
    // Get the first result's page ID
    const pageId = searchResponse.data.query.search[0]?.pageid;
    
    if (!pageId) {
      return res.json({ response: searchResponse.data.query.search });
    }
    
    // Fetch the extract (first paragraph) for the page
    const extractResponse = await axios.get(`https://en.wikipedia.org/w/api.php?action=query&format=json&prop=extracts&exintro&explaintext&pageids=${pageId}`);
    
    const result = {
      title: searchResponse.data.query.search[0].title,
      extract: extractResponse.data?.query?.pages?.[pageId]?.extract || '',
      pageid: pageId
    };
    
    res.json({ response: [result] });
  } catch (error) {
    console.error('Error:', error);
    res.status(500).json({ error: 'An error occurred while processing your Wikipedia request' });
  }
});

// API endpoint for research queries
app.post('/api/research', async (req, res) => {
  try {
    const { query } = req.body;
    
    const [geminiResponse, wikiResponse, pmcResponse] = await Promise.all([
      fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${process.env.GEMINI_API_KEY}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{
            parts: [{
              text: query
            }]
          }]
        })
      }),
      axios.get(`https://en.wikipedia.org/w/api.php?action=query&format=json&list=search&srsearch=${encodeURIComponent(query)}`)
        .then(async searchResponse => {
          if (!searchResponse.data?.query?.search) return { data: { query: { search: [] } } };
          
          const pageId = searchResponse.data.query.search[0]?.pageid;
          if (!pageId) return searchResponse;
          
          const extractResponse = await axios.get(`https://en.wikipedia.org/w/api.php?action=query&format=json&prop=extracts&exintro&explaintext&pageids=${pageId}`);
          
          return {
            data: {
              query: {
                search: [{
                  ...searchResponse.data.query.search[0],
                  extract: extractResponse.data?.query?.pages?.[pageId]?.extract || ''
                }]
              }
            }
          };
        }),
      axios.get(`https://www.ebi.ac.uk/europepmc/webservices/rest/search?query=${encodeURIComponent(query)}&format=json&resultType=core`)
        .then(pmcResponse => {
          if (!pmcResponse.data?.resultList?.result || pmcResponse.data.resultList.result.length === 0) {
            return { data: { results: null } }; // Return null to indicate no results
          }
          
          return {
            data: {
              results: pmcResponse.data.resultList.result.map(item => ({
                title: item.title || 'No title',
                abstract: item.abstractText || 'No abstract available',
                authors: item.authorList?.author?.map(a => a.fullName) || ['No authors'],
                citations: item.citedByCount || 0,
                url: `https://europepmc.org/article/MED/${item.pmid}`
              }))
            }
          };
        })
    ]);
    
    const geminiData = await geminiResponse.json();
    
    if (!geminiData?.candidates?.[0]?.content?.parts?.[0]?.text) {
      throw new Error('Invalid response structure from Gemini API');
    }
    
    const text = geminiData.candidates[0].content.parts[0].text;
    const wikiData = wikiResponse.data?.query?.search || [];
    
    res.json({ 
      geminiResponse: text,
      wikipediaResponse: wikiData,
      europepmcResponse: pmcResponse?.data?.results || []
    });
  } catch (error) {
    console.error('Error:', error);
    res.status(500).json({ error: 'An error occurred while processing your request' });
  }
});

app.listen(port, () => {
  console.log(`Server running on port ${port}`);
});