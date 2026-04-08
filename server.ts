import express from "express";
import { createServer } from "http";
import { Server } from "socket.io";
import { createServer as createViteServer } from "vite";
import path from "path";
import fs from "fs";
import { fileURLToPath } from "url";
import cors from "cors";
import dotenv from "dotenv";
dotenv.config({ path: [".env.local", ".env"] });
import { optimizeRoutesNode } from "./src/services/optimizerService";
import { GoogleGenAI, Type } from "@google/genai";

const geminiAi = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY || "" });

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function startServer() {
  const app = express();
  const httpServer = createServer(app);
  const io = new Server(httpServer, {
    cors: {
      origin: "*",
      methods: ["GET", "POST"]
    }
  });

  const PORT = 3000;

  app.use(cors());
  app.use(express.json());

  // Persistent store backing file
  const DB_FILE = path.join(__dirname, 'database.json');
  
  function getDb() {
    if (fs.existsSync(DB_FILE)) {
      try {
        return JSON.parse(fs.readFileSync(DB_FILE, 'utf-8'));
      } catch (e) {
        console.error("Failed to load db from database.json", e);
      }
    }
    return {
      orders: [] as any[],
      drivers: [] as any[],
      routes: [] as any[],
      driverLocations: {} as Record<string, { pincode: string; lastUpdate: number }>,
      settings: {
        locationName: "Karol Bagh Warehouse",
        address: "Karol Bagh, Delhi",
        pincode: "110005"
      }
    };
  }

  function saveDb(newDb: any) {
    fs.writeFileSync(DB_FILE, JSON.stringify(newDb, null, 2), 'utf-8');
  }


  // API Routes
  app.get("/api/health", (req, res) => {
    res.json({ status: "ok" });
  });

  app.get("/api/settings", (req, res) => {
    const db = getDb();
    res.json(db.settings);
  });

  app.post("/api/settings", (req, res) => {
    const db = getDb();
    db.settings = { ...db.settings, ...req.body };
    saveDb(db);
    res.json(db.settings);
  });

  app.post("/api/parse-order", async (req, res) => {
    try {
      const { command } = req.body;
      
      let parsedData = [];
      try {
        if (!geminiAi.apiKey) throw new Error("No API key");
        const response = await geminiAi.models.generateContent({
          model: "gemini-3-flash-preview",
          contents: `Extract delivery orders from this Hindi/English text: "${command}". 
          Return a JSON array of orders with fields: itemName, quantity, unit (e.g., kg, g, tons, items), location, priority (Low, Normal, Urgent), unitPrice (number).
          If priority isn't mentioned, assume 'Normal'. If unitPrice isn't mentioned, assume 100. If unit isn't mentioned, assume 'items'.`,
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
                  unitPrice: { type: Type.NUMBER }
                },
                required: ["itemName", "quantity", "unit", "location", "priority", "unitPrice"]
              }
            }
          }
        });
        parsedData = JSON.parse(response.text || "[]");
      } catch (geminiErr) {
        console.log("Falling back to local heuristic parser. Gemini Error:", geminiErr.message);
        
        // Use user-defined regex parsing logic
        const quantityRegex = /(\d+)\s?(kg|kgs|kilogram|kilo)/i;
        const cityKeywordRegex = /(?:to|in|send to|bhejna|bhejo)\s+([a-zA-Z]+)/i;
        
        // Support multiple orders in one sentence by splitting intelligently.
        // We can split by numbers to handle multiple orders inside one string.
        let orderChunks = [];
        const numberMatches = [...command.matchAll(/(\d+)\s?(kg|kgs|kilogram|kilo)/ig)];
        
        if (numberMatches.length > 0) {
          for (let i = 0; i < numberMatches.length; i++) {
            const startIndex = numberMatches[i].index;
            const endIndex = i + 1 < numberMatches.length ? numberMatches[i + 1].index : command.length;
            orderChunks.push(command.substring(startIndex, endIndex).trim());
          }
        } else {
          orderChunks.push(command); // fallback to single
        }

        parsedData = orderChunks.map(chunk => {
          let quantity = 1;
          let unit = "items";
          let item = "Item";
          let destination = "Unknown";
          
          // 1. Quantity pattern: (\d+)\s?(kg|kgs|kilogram|kilo)
          const qtyMatch = chunk.match(quantityRegex);
          if (qtyMatch) {
            quantity = parseInt(qtyMatch[1], 10);
            unit = qtyMatch[2];
            
            // 2. Item name: word immediately after the quantity
            // Find what's after the matched quantity
            const afterQtyStr = chunk.substring(qtyMatch.index + qtyMatch[0].length).trim();
            const wordsMatch = afterQtyStr.split(/\s+/);
            if (wordsMatch.length > 0) {
                // Take first distinct word that is not a city keyword
                item = wordsMatch[0].replace(/to|in|send/i, '').trim();
                if (!item && wordsMatch.length > 1) {
                    item = wordsMatch[1];
                }
                item = item.replace(/[^a-zA-Z0-9]/g, ''); // strip punctuation
                if (item) item = item.charAt(0).toUpperCase() + item.slice(1);
                else item = "Item";
            }
          }
          
          // 3. City detection: after keywords to | in | send to | bhejna | bhejo
          const cityMatch = chunk.match(cityKeywordRegex);
          if (cityMatch && cityMatch[1]) {
             destination = cityMatch[1].charAt(0).toUpperCase() + cityMatch[1].slice(1).toLowerCase();
          }

          // 5. Structure
          return {
            item: item,
            quantity: quantity,
            unit: unit,
            destination: destination,
            unitPrice: 100,
            status: "NORMAL"
          };
        });
      }
      
      res.json(parsedData);
    } catch (err) {
      console.error("Parsing Error:", err);
      res.status(500).json({ error: String(err) });
    }
  });

  app.get("/api/orders", (req, res) => {
    const db = getDb();
    res.json(db.orders);
  });

  app.post("/api/orders", (req, res) => {
    const db = getDb();
    const order = { id: Date.now().toString(), ...req.body, status: 'pending' };
    db.orders.push(order);
    saveDb(db);
    res.status(201).json(order);
  });

  app.get("/api/drivers", (req, res) => {
    const db = getDb();
    res.json(db.drivers);
  });

  app.get("/api/routes", (req, res) => {
    const db = getDb();
    res.json(db.routes);
  });

  app.post("/api/drivers", (req, res) => {
    const db = getDb();
    const driver = { id: Date.now().toString(), ...req.body, status: 'available' };
    db.drivers.push(driver);
    saveDb(db);
    res.status(201).json(driver);
  });

  // Optimization Endpoint (Node.js Clarke-Wright + Google Maps)
  app.post("/api/optimize", async (req, res) => {
    const db = getDb();
    const { selectedOrderIds } = req.body;
    
    let pendingOrders = db.orders.filter((o: any) => o.status === 'pending');
    if (selectedOrderIds && Array.isArray(selectedOrderIds)) {
      pendingOrders = pendingOrders.filter((o: any) => selectedOrderIds.includes(o.id));
    }

    const availableDrivers = db.drivers.filter((d: any) => d.status === 'available');

    if (pendingOrders.length === 0 || availableDrivers.length === 0) {
      return res.json({ assignments: [] });
    }

    const apiKey = process.env.GOOGLE_MAPS_API_KEY;
    console.log("Optimization Request - GOOGLE_MAPS_API_KEY status:", apiKey ? "Loaded successfully" : "Missing/Empty");

    try {
      const shopLoc = db.settings.pincode || db.settings.address;

      const assignments = await optimizeRoutesNode(
        shopLoc,
        pendingOrders,
        availableDrivers,
        apiKey
      );
      assignments.forEach((route: any) => {
        db.routes.push(route);
        const driver = db.drivers.find((d: any) => d.id === route.driverId);
        if (driver) driver.status = 'busy';
        route.orders.forEach((ro: any) => {
          const order = db.orders.find((o: any) => o.id === ro.id);
          if (order) order.status = 'assigned';
        });
      });

      saveDb(db);
      res.json({ assignments });
      io.emit("data:update");
    } catch (err) {
      console.error("Optimization failed:", err);
      res.status(500).json({ 
        error: "Optimization failed", 
        details: err instanceof Error ? err.message : String(err) 
      });
    }
  });

  app.get("/api/routes/:driverId", (req, res) => {
    const db = getDb();
    const route = db.routes.find((r: any) => r.driverId === req.params.driverId && r.status === 'assigned');
    res.json(route || null);
  });

  // Socket.io for real-time tracking
  io.on("connection", (socket) => {
    console.log("Client connected:", socket.id);

    socket.on("driver:location", (data: { driverId: string; pincode: string }) => {
      const db = getDb();
      db.driverLocations[data.driverId] = {
        pincode: data.pincode,
        lastUpdate: Date.now()
      };
      saveDb(db);
      // Broadcast to shop owner
      io.emit("location:update", { driverId: data.driverId, ...db.driverLocations[data.driverId] });
    });

    socket.on("route:complete", (data: { driverId: string; driverName: string }) => {
      const db = getDb();
      // Update driver status
      const driver = db.drivers.find((d: any) => d.id === data.driverId);
      if (driver) driver.status = 'available';
      
      // Update route status
      const route = db.routes.find((r: any) => r.driverId === data.driverId && r.status === 'assigned');
      if (route) route.status = 'completed';

      saveDb(db);

      // Broadcast notification to owner
      io.emit("notification:owner", { 
        type: 'route_complete',
        message: `Driver ${data.driverName} has completed their route!`,
        driverId: data.driverId,
        timestamp: Date.now()
      });

      // Broadcast data update
      io.emit("data:update");
    });

    socket.on("disconnect", () => {
      console.log("Client disconnected");
    });
  });

  // Vite middleware for development
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), "dist");
    app.use(express.static(distPath));
    app.get("*", (req, res) => {
      res.sendFile(path.join(distPath, "index.html"));
    });
  }

  httpServer.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://0.0.0.0:${PORT}`);
  });
}

startServer();
