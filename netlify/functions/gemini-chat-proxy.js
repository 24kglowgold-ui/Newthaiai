// This function acts as a serverless proxy to the Gemini API.
// It uses the native global 'fetch' API available in modern Node.js environments (like Netlify's).
// To permanently resolve the 'node-fetch' error, ensure 'node-fetch' is removed from your package.json.

// The model name is fixed as requested by the user's frontend.
const MODEL_NAME = 'gemini-2.5-flash-preview-09-2025';

// Define language-specific system instructions to guide the model's behavior
const SYSTEM_INSTRUCTIONS = {
    // English (default)
    'en': 'You are a helpful assistant specialized in providing accurate, easy-to-understand legal information and consultation regarding Thai Law. Always respond in English. Be informative, but emphasize that you are an AI and not a substitute for a human lawyer.',
    // Thai
    'th': 'คุณคือผู้ช่วยที่เชี่ยวชาญในการให้ข้อมูลทางกฎหมายและคำปรึกษาเกี่ยวกับกฎหมายไทยที่แม่นยำและเข้าใจง่าย โปรดตอบกลับเป็นภาษาไทยเสมอ ให้ข้อมูลอย่างละเอียด แต่ย้ำเสมอว่าคุณเป็น AI และไม่ใช่ทนายความที่มนุษย์',
    // Simplified Chinese
    'zh-CN': '您是一位乐于助人的助手，专门提供关于泰国法律的准确、易懂的法律信息和咨询。请始终用简体中文回复。提供详细信息，但请始终强调您是AI，不能替代人类律师。'
};

/**
 * Netlify function handler.
 * @param {object} event - The event object from Netlify.
 * @returns {Promise<object>} - The response object.
 */
exports.handler = async function(event) {
    if (event.httpMethod !== 'POST') {
        return {
            statusCode: 405,
            body: JSON.stringify({ error: 'Method Not Allowed' })
        };
    }

    // Retrieve the API Key from environment variables (set securely in Netlify UI)
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
        // Log the error internally
        console.error("GEMINI_API_KEY is not set in environment variables.");
        // Return a public-facing error indicating the key is missing
        return {
            statusCode: 500,
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ 
                error: "Server configuration error", 
                detail: "API_KEY_MISSING" 
            })
        };
    }

    try {
        const { chatHistory, languageCode } = JSON.parse(event.body);

        const systemPrompt = SYSTEM_INSTRUCTIONS[languageCode] || SYSTEM_INSTRUCTIONS['en'];

        const payload = {
            // The history array contains the conversation context (user and model turns)
            contents: chatHistory,
            // Configuration for the generation process
            config: {
                systemInstruction: systemPrompt,
            },
            // Enable Google Search for grounding and up-to-date information
            tools: [{ googleSearch: {} }],
        };

        const apiUrl = `https://generativelanguage.googleapis.com/v1beta/models/${MODEL_NAME}:generateContent?key=${apiKey}`;

        // Use the native global 'fetch' instead of importing 'node-fetch'
        const response = await fetch(apiUrl, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                // API keys are generally passed in the URL, but setting any custom headers is fine.
            },
            body: JSON.stringify(payload)
        });

        // Handle HTTP errors from the Gemini API call itself
        if (!response.ok) {
            const errorText = await response.text();
            console.error(`Gemini API Error Status: ${response.status}`, errorText);
            
            // Re-throw to be caught by the outer catch block
            throw new Error(`Gemini API call failed with status ${response.status}: ${errorText}`);
        }

        const result = await response.json();

        // Check if the response contains generated text
        const generatedText = result?.candidates?.[0]?.content?.parts?.[0]?.text;
        
        if (!generatedText) {
            // Handle cases where the model blocks the response or returns empty content
             console.warn("Gemini API returned no text content.", JSON.stringify(result));
             return {
                statusCode: 500,
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ error: "No response text received from the model." })
            };
        }

        // Extract grounding sources (citations)
        let sources = [];
        const groundingMetadata = result.candidates?.[0]?.groundingMetadata;

        if (groundingMetadata?.groundingAttributions) {
            sources = groundingMetadata.groundingAttributions
                .map(attribution => ({
                    uri: attribution.web?.uri,
                    title: attribution.web?.title,
                }))
                .filter(source => source.uri && source.title) // Only keep valid sources
                .slice(0, 3); // Limit to top 3 sources for brevity
        }

        return {
            statusCode: 200,
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ text: generatedText, sources: sources })
        };

    } catch (error) {
        console.error('Function error:', error.message);
        return {
            statusCode: 500,
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ error: 'Internal Server Error', detail: error.message })
        };
    }
};