import express from "express";
import { createServer } from "http";
import { Server } from "socket.io";
import { createServer as createViteServer } from "vite";
import path from "path";
import { fileURLToPath } from "url";
import cors from "cors";
import "dotenv/config";
import { optimizeRoutesNode } from "./src/services/optimizerService";

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

  // In-memory store for prototype (SQLite can be added later if needed)
  const orders: any[] = [];
  const drivers: any[] = [];
  const routes: any[] = [];
  const driverLocations: Record<string, { pincode: string; lastUpdate: number }> = {};
  let settings = {
    locationName: "Karol Bagh Warehouse",
    address: "Karol Bagh, Delhi",
    pincode: "110005"
  };

  // API Routes
  app.get("/api/health", (req, res) => {
    res.json({ status: "ok" });
  });

  app.get("/api/settings", (req, res) => {
    res.json(settings);
  });

  app.post("/api/settings", (req, res) => {
    settings = { ...settings, ...req.body };
    res.json(settings);
  });

  app.get("/api/orders", (req, res) => {
    res.json(orders);
  });

  app.post("/api/orders", (req, res) => {
    const order = { id: Date.now().toString(), ...req.body, status: 'pending' };
    orders.push(order);
    res.status(201).json(order);
  });

  app.get("/api/drivers", (req, res) => {
    res.json(drivers);
  });

  app.get("/api/routes", (req, res) => {
    res.json(routes);
  });

  app.post("/api/drivers", (req, res) => {
    const driver = { id: Date.now().toString(), ...req.body, status: 'available' };
    drivers.push(driver);
    res.status(201).json(driver);
  });

  // Optimization Endpoint (Node.js Clarke-Wright + Google Maps)
  app.post("/api/optimize", async (req, res) => {
    const { selectedOrderIds } = req.body;
    
    let pendingOrders = orders.filter(o => o.status === 'pending');
    if (selectedOrderIds && Array.isArray(selectedOrderIds)) {
      pendingOrders = pendingOrders.filter(o => selectedOrderIds.includes(o.id));
    }

    const availableDrivers = drivers.filter(d => d.status === 'available');

    if (pendingOrders.length === 0 || availableDrivers.length === 0) {
      return res.json({ assignments: [] });
    }

    const apiKey = process.env.GOOGLE_MAPS_API_KEY;
    if (!apiKey) {
      return res.status(500).json({ error: "Missing GOOGLE_MAPS_API_KEY environment variable" });
    }

    try {
      const shopLoc = settings.pincode || settings.address;

      const assignments = await optimizeRoutesNode(
        shopLoc,
        pendingOrders,
        availableDrivers,
        apiKey
      );
      assignments.forEach((route: any) => {
        routes.push(route);
        const driver = drivers.find(d => d.id === route.driverId);
        if (driver) driver.status = 'busy';
        route.orders.forEach((ro: any) => {
          const order = orders.find(o => o.id === ro.id);
          if (order) order.status = 'assigned';
        });
      });

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
    const route = routes.find(r => r.driverId === req.params.driverId && r.status === 'assigned');
    res.json(route || null);
  });

  // Socket.io for real-time tracking
  io.on("connection", (socket) => {
    console.log("Client connected:", socket.id);

    socket.on("driver:location", (data: { driverId: string; pincode: string }) => {
      driverLocations[data.driverId] = {
        pincode: data.pincode,
        lastUpdate: Date.now()
      };
      // Broadcast to shop owner
      io.emit("location:update", { driverId: data.driverId, ...driverLocations[data.driverId] });
    });

    socket.on("route:complete", (data: { driverId: string; driverName: string }) => {
      // Update driver status
      const driver = drivers.find(d => d.id === data.driverId);
      if (driver) driver.status = 'available';
      
      // Update route status
      const route = routes.find(r => r.driverId === data.driverId && r.status === 'assigned');
      if (route) route.status = 'completed';

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
