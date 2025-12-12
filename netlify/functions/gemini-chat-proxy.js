import fetch from 'node-fetch';

// This is the model we will use for text generation and grounding.
const MODEL_NAME = 'gemini-2.5-flash-preview-09-2025';

// You must set this environment variable in Netlify for security.
// The user is not required to provide a key in the frontend.
const API_KEY = process.env.GEMINI_API_KEY;

// System instruction that defines the AI's role and focus on Thai law.
// This is what ensures the chatbot is focused on Thailand.
const SYSTEM_INSTRUCTION = `
You are a knowledgeable, professional, and safety-conscious assistant specializing in Thai law (กฎหมายไทย) and related legal concepts. 
Your primary function is to provide helpful, concise, and grounded summaries and explanations related to the law of Thailand.

RULES:
1.  **Safety First:** Always include a strong disclaimer in every response stating: "I am an AI and cannot provide legal advice. Please consult a qualified lawyer (ทนายความ) for professional advice."
2.  **Focus:** Base your answers primarily on Thai law. If the user asks about a different country's law, inform them that you specialize in Thai law and can only provide general information or Thai equivalents.
3.  **Language:** Respond in the user's selected language (Thai, English, or Simplified Chinese). The requested language is provided in the 'language' field of the payload.
4.  **Grounding:** Use the Google Search tool to ensure all legal information is current and accurate.
5.  **Tone:** Maintain a polite and professional tone.
`;

// Helper function for exponential backoff retry logic
const withRetry = async (fn, retries = 3) => {
    let lastError;
    for (let i = 0; i < retries; i++) {
        try {
            return await fn();
        } catch (error) {
            lastError = error;
            const delay = Math.pow(2, i) * 1000 + Math.random() * 1000;
            if (i < retries - 1) {
                // console.log(`Attempt ${i + 1} failed, retrying in ${delay / 1000}s...`);
                await new Promise(resolve => setTimeout(resolve, delay));
            }
        }
    }
    throw lastError;
};

export async function handler(event, context) {
    if (event.httpMethod !== 'POST') {
        return { statusCode: 405, body: 'Method Not Allowed' };
    }

    if (!API_KEY) {
        // Return a specific error detail for the frontend to handle
        return {
            statusCode: 400,
            body: JSON.stringify({ error: 'API Key is missing.', detail: 'API_KEY_MISSING' }),
        };
    }

    try {
        const { chatHistory, language } = JSON.parse(event.body);

        if (!chatHistory || !Array.isArray(chatHistory)) {
            return { statusCode: 400, body: JSON.stringify({ error: 'Invalid chat history format.' }) };
        }

        // Construct the contents array from the chat history
        const contents = chatHistory.map(item => ({
            role: item.role === 'user' ? 'user' : 'model',
            parts: [{ text: item.text }]
        }));

        // The final user prompt includes the language instruction
        // We modify the last message in the contents array to include the language instruction
        const lastUserPrompt = contents[contents.length - 1].parts[0].text;
        contents[contents.length - 1].parts[0].text = `Respond in ${language}. User query: ${lastUserPrompt}`;


        const payload = {
            contents: contents,
            tools: [{ "google_search": {} }], // Enable Google Search grounding
            systemInstruction: {
                parts: [{ text: SYSTEM_INSTRUCTION }]
            },
            config: {
                // Ensure model doesn't generate excessive content
                maxOutputTokens: 2048, 
            }
        };

        const apiUrl = `https://generativelanguage.googleapis.com/v1beta/models/${MODEL_NAME}:generateContent?key=${API_KEY}`;

        const geminiResponse = await withRetry(async () => {
            const response = await fetch(apiUrl, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload)
            });

            if (!response.ok) {
                const errorBody = await response.text();
                throw new Error(`Gemini API Error: ${response.status} - ${errorBody}`);
            }

            return response.json();
        });

        // 1. Extract the generated text
        const candidate = geminiResponse.candidates?.[0];
        const text = candidate?.content?.parts?.[0]?.text || 'No response generated.';

        // 2. Extract grounding sources
        let sources = [];
        const groundingMetadata = candidate?.groundingMetadata;
        if (groundingMetadata && groundingMetadata.groundingAttributions) {
            sources = groundingMetadata.groundingAttributions
                .map(attribution => ({
                    uri: attribution.web?.uri,
                    title: attribution.web?.title,
                }))
                .filter(source => source.uri && source.title); // Ensure sources are valid
        }

        return {
            statusCode: 200,
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ text, sources }),
        };

    } catch (error) {
        // console.error('Netlify Function Error:', error);
        return {
            statusCode: 500,
            body: JSON.stringify({ error: 'Internal Server Error', detail: error.message }),
        };
    }
}