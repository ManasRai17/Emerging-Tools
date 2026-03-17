import { GoogleGenAI, Type } from "@google/genai";

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY || "" });

export const parseHindiOrder = async (command: string) => {
  const response = await ai.models.generateContent({
    model: "gemini-3-flash-preview",
    contents: `Extract delivery orders from this Hindi/English text: "${command}". 
    Return a JSON array of orders with fields: itemName, quantity, unit (e.g., kg, g, tons, items), location, priority (Low, Normal, Urgent), value (number).
    If priority isn't mentioned, assume 'Normal'. If value isn't mentioned, assume 100. If unit isn't mentioned, assume 'items'.`,
    config: {
      responseMimeType: "application/json",
      responseSchema: {
        type: Type.ARRAY,
        items: {
          type: Type.OBJECT,
          properties: {
            itemName: { type: Type.STRING },
            quantity: { type: Type.NUMBER },
            unit: { type: Type.STRING },
            location: { type: Type.STRING },
            priority: { type: Type.STRING, enum: ["Low", "Normal", "Urgent"] },
            value: { type: Type.NUMBER }
          },
          required: ["itemName", "quantity", "unit", "location", "priority", "value"]
        }
      }
    }
  });

  return JSON.parse(response.text || "[]");
};
