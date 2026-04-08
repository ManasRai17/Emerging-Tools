import React, { useState, useEffect, useRef } from 'react';
import { io, Socket } from 'socket.io-client';
import { 
  Truck, 
  Package, 
  MapPin, 
  Plus, 
  Mic, 
  Navigation, 
  CheckCircle2, 
  Clock,
  TrendingUp,
  User,
  ExternalLink,
  LayoutDashboard,
  Settings,
  AlertCircle,
  AlertTriangle,
  Map as MapIcon
} from 'lucide-react';
import { MapContainer, TileLayer, Marker, Popup, useMap } from 'react-leaflet';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';

// Fix for default marker icon in Leaflet
// @ts-ignore
delete L.Icon.Default.prototype._getIconUrl;
L.Icon.Default.mergeOptions({
  iconRetinaUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.7.1/images/marker-icon-2x.png',
  iconUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.7.1/images/marker-icon.png',
  shadowUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.7.1/images/marker-shadow.png',
});

const PINCODE_COORDS: Record<string, [number, number]> = {
  "110001": [28.6327, 77.2197],
  "110005": [28.6508, 77.1911],
  "110008": [28.6453, 77.1587],
  "110012": [28.6369, 77.1688],
  "110060": [28.6415, 77.1833],
  "110015": [28.6631, 77.1444],
  "110018": [28.6421, 77.0941],
  "110024": [28.5684, 77.2345],
  "110027": [28.6533, 77.1245],
  "110034": [28.6941, 77.1307],
};
import { motion, AnimatePresence } from 'motion/react';
import { parseHindiOrder } from './services/geminiService';
import { Order, Driver, Route, DriverLocation, AppSettings } from './types';

const MapFocusHandler: React.FC<{ coords: [number, number] | null }> = ({ coords }) => {
  const map = useMap();
  useEffect(() => {
    if (coords) {
      map.setView(coords, 15, { animate: true });
    }
  }, [coords, map]);
  return null;
};

const App: React.FC = () => {
  const [view, setView] = useState<'owner' | 'driver' | 'settings' | 'drivers' | 'map'>('owner');
  const [orders, setOrders] = useState<Order[]>([]);
  const [drivers, setDrivers] = useState<Driver[]>([]);
  const [routes, setRoutes] = useState<Route[]>([]);
  const [locations, setLocations] = useState<Record<string, DriverLocation>>({});
  const [isRecording, setIsRecording] = useState(false);
  const [isListening, setIsListening] = useState(false);
  const [speechLang, setSpeechLang] = useState<'hi-IN' | 'en-US'>('hi-IN');
  const [voiceInput, setVoiceInput] = useState("");
  const [activeDriverId, setActiveDriverId] = useState<string | null>(null);
  const [statusMessage, setStatusMessage] = useState<{ text: string, type: 'error' | 'success' } | null>(null);
  const [settings, setSettings] = useState<AppSettings | null>(null);
  const [selectedOrderIds, setSelectedOrderIds] = useState<string[]>([]);
  const [filterAvailableOnly, setFilterAvailableOnly] = useState(false);
  const [isAddDriverModalOpen, setIsAddDriverModalOpen] = useState(false);
  const [isTracking, setIsTracking] = useState(false);
  const [mapFocusDriverId, setMapFocusDriverId] = useState<string | null>(null);
  const [newDriver, setNewDriver] = useState({
    name: '',
    phone: '',
    vehicleNumber: '',
    vehicleType: '',
    currentLocation: '',
    capacity: 1000
  });
  
  const socketRef = useRef<Socket | null>(null);
  const recognitionRef = useRef<any>(null);

  useEffect(() => {
    socketRef.current = io();
    
    socketRef.current.on('location:update', (data: DriverLocation) => {
      setLocations(prev => ({ ...prev, [data.driverId]: data }));
    });

    socketRef.current.on('notification:owner', (data: { message: string }) => {
      setStatusMessage({ text: data.message, type: 'success' });
      setTimeout(() => setStatusMessage(null), 5000);
    });

    socketRef.current.on('data:update', () => {
      fetchInitialData();
    });

    fetchInitialData();

    return () => {
      socketRef.current?.disconnect();
    };
  }, []);

  useEffect(() => {
    let interval: any;
    if (isTracking && activeDriverId && socketRef.current) {
      interval = setInterval(() => {
        // Simulate movement between local pincodes for the prototype
        const pincodes = Object.keys(PINCODE_COORDS);
        const pincode = pincodes[Math.floor(Math.random() * pincodes.length)];
        socketRef.current?.emit("driver:location", { driverId: activeDriverId, pincode });
      }, 5000); // Update every 5 seconds
    }
    return () => clearInterval(interval);
  }, [isTracking, activeDriverId]);

  const fetchInitialData = async () => {
    try {
      const [ordersRes, driversRes, settingsRes, routesRes] = await Promise.all([
        fetch('/api/orders'),
        fetch('/api/drivers'),
        fetch('/api/settings'),
        fetch('/api/routes')
      ]);
      setOrders(await ordersRes.json());
      setDrivers(await driversRes.json());
      setSettings(await settingsRes.json());
      setRoutes(await routesRes.json());
    } catch (err) {
      console.error("Failed to fetch data", err);
    }
  };

  const getRouteDistance = (route: Route) => {
    const startPincode = settings?.pincode || "110005";
    const startCoords = PINCODE_COORDS[startPincode] || PINCODE_COORDS["110005"];
    
    let totalDist = 0;
    let current = startCoords;
    
    route.orders.forEach(order => {
      const locStr = order.location || order.destination || "";
      const match = locStr.match(/\d{6}/);
      const pin = match ? match[0] : null;
      const coords = pin ? PINCODE_COORDS[pin] : null;
      
      if (coords) {
        const d = Math.sqrt(Math.pow(coords[0] - current[0], 2) + Math.pow(coords[1] - current[1], 2)) * 111;
        totalDist += d;
        current = coords;
      } else {
        totalDist += 3;
      }
    });
    
    totalDist += Math.sqrt(Math.pow(startCoords[0] - current[0], 2) + Math.pow(startCoords[1] - current[1], 2)) * 111;
    return totalDist;
  };

  const getEstimatedTime = (route: Route) => {
    const totalDist = getRouteDistance(route);
    const avgSpeed = 20; 
    const travelTime = (totalDist / avgSpeed) * 60;
    const serviceTime = route.orders.length * 8; 
    
    const totalMinutes = Math.round(travelTime + serviceTime);
    if (totalMinutes < 60) return `${totalMinutes}m`;
    const hours = Math.floor(totalMinutes / 60);
    const mins = totalMinutes % 60;
    return `${hours}h ${mins}m`;
  };

  const calculateProfit = () => {
    // Orders that are heavily selected for optimization OR already mathematically mapped out into an active fleet operation
    const activeOrders = orders.filter(o => o.status === 'assigned' || selectedOrderIds.includes(o.id));
    
    // Revenue maps directly out from base logic quantity index multiplied by generic fallback unitPrice assumptions
    const revenue = activeOrders.reduce((sum, order) => {
      const activeUnitPrice = order.unitPrice || order.price || order.value || 100;
      return sum + ((order.quantity || 1) * activeUnitPrice);
    }, 0);

    // Calculate Costs based explicitly around actual Google Route Distances if generated, natively defaulting otherwise
    let estimatedCost = 0;
    if (routes.length > 0) {
      const FUEL_COST_PER_KM = 8;
      const DRIVER_FIXED_COST = 300;
      routes.forEach(route => {
        if (route.status === 'assigned' || route.status === 'in-progress' || route.status === 'completed') {
          const dist = getRouteDistance(route);
          estimatedCost += (dist * FUEL_COST_PER_KM) + DRIVER_FIXED_COST;
        }
      });
    } else {
      // 40% margin operational costs proxy when purely hypothetical
      estimatedCost = revenue * 0.4;
    }
    
    const profit = revenue - estimatedCost;
    
    return {
      profit: Math.round(profit),
      revenue: Math.round(revenue),
      cost: Math.round(estimatedCost)
    };
  };

  const toggleListening = () => {
    if (isListening) {
      recognitionRef.current?.stop();
      return;
    }

    const SpeechRecognition = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (!SpeechRecognition) {
      alert("Speech recognition is not supported in this browser.");
      return;
    }

    const recognition = new SpeechRecognition();
    recognitionRef.current = recognition;
    recognition.lang = speechLang;
    recognition.interimResults = false;
    recognition.maxAlternatives = 1;

    recognition.onstart = () => setIsListening(true);
    recognition.onend = () => setIsListening(false);
    recognition.onerror = () => setIsListening(false);

    recognition.onresult = (event: any) => {
      const transcript = event.results[0][0].transcript;
      setVoiceInput(prev => prev ? `${prev} ${transcript}` : transcript);
    };

    recognition.start();
  };

  const handleVoiceCommand = async () => {
    if (!voiceInput) return;
    setIsRecording(true);
    try {
      const parsedOrders = await parseHindiOrder(voiceInput);
      for (const order of parsedOrders) {
        const res = await fetch('/api/orders', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(order)
        });
        const newOrder = await res.json();
        setOrders(prev => [...prev, newOrder]);
      }
      setVoiceInput("");
    } catch (err) {
      console.error("AI Parsing failed", err);
      setStatusMessage({ text: "Could not understand the order. Please try again.", type: 'error' });
    } finally {
      setIsRecording(false);
    }
  };

  const optimizeRoutes = async () => {
    try {
      const res = await fetch('/api/optimize', { 
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ selectedOrderIds })
      });
      const data = await res.json();
      
      if (data.assignments && Array.isArray(data.assignments)) {
        setRoutes(prev => [...prev, ...data.assignments]);
        setStatusMessage({ text: `Successfully optimized ${data.assignments.length} routes`, type: 'success' });
        fetchInitialData(); // Refresh statuses
      } else if (data.error) {
        console.error("Optimization error:", data.error);
        setStatusMessage({ text: `Optimization failed: ${data.error}`, type: 'error' });
      }
    } catch (err) {
      console.error("Failed to optimize routes", err);
      setStatusMessage({ text: "Failed to connect to optimization service", type: 'error' });
    } finally {
      setTimeout(() => setStatusMessage(null), 5000);
    }
  };

  const handleAddDriver = async () => {
    if (!newDriver.name || !newDriver.phone) {
      setStatusMessage({ text: "Name and Phone are required", type: 'error' });
      return;
    }
    
    try {
      const res = await fetch('/api/drivers', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(newDriver)
      });
      const data = await res.json();
      setDrivers(prev => [...prev, data]);
      setIsAddDriverModalOpen(false);
      setNewDriver({
        name: '',
        phone: '',
        vehicleNumber: '',
        vehicleType: '',
        currentLocation: '',
        capacity: 1000
      });
      setStatusMessage({ text: "Driver added successfully", type: 'success' });
    } catch (err) {
      console.error("Failed to add driver", err);
      setStatusMessage({ text: "Failed to add driver", type: 'error' });
    }
    setTimeout(() => setStatusMessage(null), 3000);
  };

  return (
    <div className="min-h-screen bg-[#F5F5F4] text-[#1C1917] font-sans">
      {/* Navigation Rail */}
      <nav className="fixed left-0 top-0 h-full w-16 bg-white border-r border-stone-200 flex flex-col items-center py-8 gap-8 z-50">
        <div className="w-10 h-10 bg-emerald-600 rounded-xl flex items-center justify-center text-white shadow-lg shadow-emerald-200">
          <Truck size={24} />
        </div>
        <button 
          onClick={() => setView('owner')}
          className={`p-3 rounded-xl transition-all ${view === 'owner' ? 'bg-stone-100 text-emerald-600' : 'text-stone-400 hover:bg-stone-50'}`}
        >
          <LayoutDashboard size={24} />
        </button>
        <button 
          onClick={() => setView('driver')}
          className={`p-3 rounded-xl transition-all ${view === 'driver' ? 'bg-stone-100 text-emerald-600' : 'text-stone-400 hover:bg-stone-50'}`}
        >
          <User size={24} />
        </button>
        <button 
          onClick={() => setView('drivers')}
          className={`p-3 rounded-xl transition-all ${view === 'drivers' ? 'bg-stone-100 text-emerald-600' : 'text-stone-400 hover:bg-stone-50'}`}
        >
          <Truck size={24} />
        </button>
        <button 
          onClick={() => setView('map')}
          className={`p-3 rounded-xl transition-all ${view === 'map' ? 'bg-stone-100 text-emerald-600' : 'text-stone-400 hover:bg-stone-50'}`}
        >
          <MapIcon size={24} />
        </button>
        <div className="mt-auto">
          <button 
            onClick={() => setView('settings')}
            className={`p-3 rounded-xl transition-all ${view === 'settings' ? 'bg-stone-100 text-emerald-600' : 'text-stone-400 hover:bg-stone-50'}`}
          >
            <Settings size={24} />
          </button>
        </div>
      </nav>

      <main className="pl-16 min-h-screen">
        <AnimatePresence>
          {statusMessage && (
            <motion.div 
              initial={{ opacity: 0, y: -20 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -20 }}
              className={`fixed top-4 right-4 z-[100] px-6 py-3 rounded-xl shadow-lg text-white font-medium ${statusMessage.type === 'error' ? 'bg-red-600' : 'bg-emerald-600'}`}
            >
              {statusMessage.text}
            </motion.div>
          )}
        </AnimatePresence>

        {view === 'map' && (
          <div className="h-screen w-full p-8">
            <div className="bg-white rounded-3xl border border-stone-200 shadow-sm h-full overflow-hidden flex flex-col">
              <div className="p-6 border-b border-stone-100 flex justify-between items-center">
                <div>
                  <h2 className="text-2xl font-bold">Live Fleet Map</h2>
                  <p className="text-stone-500">Real-time tracking of all active drivers</p>
                </div>
                <div className="flex gap-4">
                  {mapFocusDriverId && (
                    <button 
                      onClick={() => setMapFocusDriverId(null)}
                      className="px-4 py-1.5 bg-stone-100 text-stone-600 rounded-xl text-xs font-bold hover:bg-stone-200 transition-all"
                    >
                      Clear Focus
                    </button>
                  )}
                  <div className="flex items-center gap-2">
                    <div className="w-3 h-3 rounded-full bg-emerald-500 shadow-[0_0_8px_rgba(16,185,129,0.5)]" />
                    <span className="text-sm font-medium">Active</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <div className="w-3 h-3 rounded-full bg-stone-300" />
                    <span className="text-sm font-medium">Offline</span>
                  </div>
                </div>
              </div>
              <div className="flex-1 relative z-0">
                <MapContainer 
                  center={[28.64, 77.18]} 
                  zoom={13} 
                  style={{ height: '100%', width: '100%' }}
                >
                  <TileLayer
                    url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
                    attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
                  />
                  {mapFocusDriverId && locations[mapFocusDriverId] && (
                    <MapFocusHandler coords={PINCODE_COORDS[locations[mapFocusDriverId].pincode] || null} />
                  )}
                  {drivers.map(driver => {
                    const loc = locations[driver.id];
                    const pincode = loc?.pincode || driver.currentLocation;
                    const coords = PINCODE_COORDS[pincode] || [28.64, 77.18];
                    
                    return (
                      <Marker key={driver.id} position={coords}>
                        <Popup>
                          <div className="p-2">
                            <h3 className="font-bold text-lg">{driver.name}</h3>
                            <p className="text-stone-600">{driver.vehicleType} - {driver.vehicleNumber}</p>
                            <div className="mt-2 flex items-center gap-2">
                              <div className={`w-2 h-2 rounded-full ${loc ? 'bg-emerald-500' : 'bg-stone-300'}`} />
                              <span className="text-xs font-bold uppercase">{loc ? 'Live' : 'Last Known'}</span>
                            </div>
                            <p className="text-xs text-stone-400 mt-1">Location: {pincode}</p>
                          </div>
                        </Popup>
                      </Marker>
                    );
                  })}
                </MapContainer>
              </div>
            </div>
          </div>
        )}

        {view === 'owner' ? (
          <div className="p-8 max-w-7xl mx-auto">
            <header className="flex justify-between items-end mb-12">
              <div>
                <h1 className="text-4xl font-semibold tracking-tight mb-2">CargoIQ Dashboard</h1>
                <p className="text-stone-500">Optimizing {orders.length} deliveries for today</p>
              </div>
              <div className="flex gap-4">
                <button 
                  onClick={optimizeRoutes}
                  disabled={selectedOrderIds.length === 0}
                  className="px-6 py-3 bg-emerald-600 text-white rounded-xl font-medium shadow-lg shadow-emerald-100 hover:bg-emerald-700 transition-all flex items-center gap-2 disabled:opacity-50"
                >
                  <TrendingUp size={20} />
                  Optimize Selected ({selectedOrderIds.length})
                </button>
              </div>
            </header>

            <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
              {/* Voice Input Section */}
              <section className="lg:col-span-2 space-y-8">
                <div className="bg-white p-8 rounded-3xl border border-stone-200 shadow-sm">
                  <div className="flex items-center justify-between mb-6">
                    <div className="flex items-center gap-3">
                      <div className="w-8 h-8 bg-emerald-100 text-emerald-600 rounded-lg flex items-center justify-center">
                        <Mic size={18} />
                      </div>
                      <h2 className="text-xl font-semibold">Voice Order</h2>
                    </div>
                    <div className="flex bg-stone-100 p-1 rounded-xl">
                      <button 
                        onClick={() => setSpeechLang('hi-IN')}
                        className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-all ${speechLang === 'hi-IN' ? 'bg-white text-emerald-600 shadow-sm' : 'text-stone-500'}`}
                      >
                        Hindi
                      </button>
                      <button 
                        onClick={() => setSpeechLang('en-US')}
                        className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-all ${speechLang === 'en-US' ? 'bg-white text-emerald-600 shadow-sm' : 'text-stone-500'}`}
                      >
                        English
                      </button>
                    </div>
                  </div>
                  <div className="relative">
                    <textarea 
                      value={voiceInput}
                      onChange={(e) => setVoiceInput(e.target.value)}
                      placeholder={speechLang === 'hi-IN' ? 'उदा. "3 केक करोल बाग भेजने हैं, अर्जेंट है"' : 'e.g., "Send 3 cakes to Karol Bagh, urgent"'}
                      className="w-full h-32 p-4 bg-stone-50 border border-stone-200 rounded-2xl focus:ring-2 focus:ring-emerald-500 focus:border-transparent outline-none transition-all resize-none"
                    />
                    <div className="absolute bottom-4 right-4 flex gap-2">
                      <button 
                        onClick={toggleListening}
                        className={`p-3 rounded-xl transition-all ${isListening ? 'bg-red-100 text-red-600 animate-pulse' : 'bg-stone-100 text-stone-600 hover:bg-stone-200'}`}
                        title={isListening ? "Stop Recording" : "Start Recording"}
                      >
                        <Mic size={20} />
                      </button>
                      <button 
                        onClick={handleVoiceCommand}
                        disabled={isRecording || !voiceInput}
                        className="px-6 py-2 bg-emerald-600 text-white rounded-xl text-sm font-medium disabled:opacity-50 shadow-lg shadow-emerald-100"
                      >
                        {isRecording ? "Parsing..." : "Process Order"}
                      </button>
                    </div>
                  </div>
                </div>

                {/* Orders List */}
                <div className="bg-white rounded-3xl border border-stone-200 shadow-sm overflow-hidden">
                  <div className="p-6 border-bottom border-stone-100 flex justify-between items-center">
                    <h2 className="text-xl font-semibold">Pending Orders</h2>
                    <span className="px-3 py-1 bg-stone-100 text-stone-600 rounded-full text-xs font-medium">
                      {orders.filter(o => o.status === 'pending').length} Total
                    </span>
                  </div>
                  <div className="divide-y divide-stone-100">
                    {orders.filter(o => o.status === 'pending').length === 0 && (
                      <div className="p-12 text-center text-stone-400">
                        No pending orders. Record a voice command to add some!
                      </div>
                    )}
                    {orders.filter(o => o.status === 'pending').map(order => (
                      <div 
                        key={order.id} 
                        className={`p-6 flex items-center justify-between transition-colors ${
                          order.priority === 'Emergency' ? 'bg-red-50/50 hover:bg-red-50' :
                          order.priority === 'Urgent' ? 'bg-orange-50/50 hover:bg-orange-50' : 
                          'hover:bg-stone-50'
                        }`}
                      >
                        <div className="flex items-center gap-4">
                          <input 
                            type="checkbox" 
                            checked={selectedOrderIds.includes(order.id)}
                            onChange={(e) => {
                              if (e.target.checked) {
                                setSelectedOrderIds(prev => [...prev, order.id]);
                              } else {
                                setSelectedOrderIds(prev => prev.filter(id => id !== order.id));
                              }
                            }}
                            className="w-5 h-5 rounded border-stone-300 text-emerald-600 focus:ring-emerald-500"
                          />
                          <div className={`w-12 h-12 rounded-2xl flex items-center justify-center ${
                            order.priority === 'Emergency' ? 'bg-red-100 text-red-600' :
                            order.priority === 'Urgent' ? 'bg-orange-100 text-orange-600' : 'bg-blue-100 text-blue-600'
                          }`}>
                            {order.priority === 'Emergency' ? <AlertCircle size={24} /> : 
                             order.priority === 'Urgent' ? <AlertTriangle size={24} /> : 
                             <Package size={24} />}
                          </div>
                          <div>
                            <h3 className="font-medium">{order.item || order.itemName} ({order.quantity} {order.unit})</h3>
                            <div className="flex items-center gap-2 text-sm text-stone-500">
                              <MapPin size={14} />
                              {order.destination || order.location}
                            </div>
                          </div>
                        </div>
                        <div className="text-right">
                          <div className="font-semibold text-emerald-600 flex flex-col items-end">
                            <span className="text-lg">₹{(order.quantity || 1) * (order.unitPrice || order.price || order.value || 100)}</span>
                            <span className="text-[10px] text-stone-400 font-medium tracking-wide">
                              {order.quantity || 1} {order.unit || 'unit'} × ₹{order.unitPrice || order.price || order.value || 100}
                            </span>
                          </div>
                          <div className={`text-xs font-medium uppercase tracking-wider mt-1 ${
                            (order.status === 'Emergency' || order.priority === 'Emergency') ? 'text-red-600' :
                            (order.status === 'Urgent' || order.priority === 'Urgent') ? 'text-orange-600' : 
                            (order.status === 'NORMAL' ? 'text-blue-600' : 'text-stone-400')
                          }`}>
                            {order.status === 'pending' ? (order.priority || 'NORMAL') : (order.status || order.priority)}
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>

                {/* Assigned Routes Section */}
                <div className="bg-white rounded-3xl border border-stone-200 shadow-sm overflow-hidden">
                  <div className="p-6 border-b border-stone-100 flex justify-between items-center">
                    <h2 className="text-xl font-semibold">Optimized Routes</h2>
                    <div className="flex items-center gap-4">
                      <div className="flex items-center gap-2">
                        <span className="text-xs text-stone-500">Available Drivers Only</span>
                        <button 
                          onClick={() => setFilterAvailableOnly(!filterAvailableOnly)}
                          className={`w-10 h-5 rounded-full transition-colors relative ${filterAvailableOnly ? 'bg-emerald-500' : 'bg-stone-200'}`}
                        >
                          <div className={`absolute top-1 w-3 h-3 bg-white rounded-full transition-all ${filterAvailableOnly ? 'left-6' : 'left-1'}`} />
                        </button>
                      </div>
                      <span className="px-3 py-1 bg-emerald-100 text-emerald-600 rounded-full text-xs font-medium">
                        {routes.filter(r => r.status === 'assigned' || r.status === 'completed').length} Total
                      </span>
                    </div>
                  </div>
                  <div className="divide-y divide-stone-100">
                    {routes.filter(r => r.status === 'assigned' || r.status === 'completed').length === 0 && (
                      <div className="p-12 text-center text-stone-400">
                        No routes found. Click "Optimize Routes" to assign drivers.
                      </div>
                    )}
                    {routes.filter(r => {
                      const isValidStatus = r.status === 'assigned' || r.status === 'completed';
                      if (!isValidStatus) return false;
                      if (filterAvailableOnly) {
                        const driver = drivers.find(d => d.id === r.driverId);
                        return driver?.status === 'available';
                      }
                      return true;
                    }).map(route => {
                      const driver = drivers.find(d => d.id === route.driverId);
                      const waypoints = route.orders.map(o => encodeURIComponent(o.location || o.destination || '')).join('|');
                      const startLoc = settings?.pincode || settings?.address || 'Karol Bagh, Delhi';
                      const encodedStart = encodeURIComponent(startLoc);
                      const mapUrl = `https://www.google.com/maps/dir/?api=1&origin=${encodedStart}&destination=${encodedStart}&waypoints=${waypoints}`;
                      
                      return (
                        <div key={route.id} className="p-6 hover:bg-stone-50 transition-colors">
                          <div className="flex items-center justify-between mb-4">
                            <div className="flex items-center gap-3">
                              <div className="w-10 h-10 bg-emerald-50 text-emerald-600 rounded-xl flex items-center justify-center">
                                <Truck size={20} />
                              </div>
                              <div>
                                <div className="font-semibold">{driver?.name || 'Unknown Driver'}</div>
                                <div className="flex items-center gap-2">
                                  <div className="text-xs text-stone-500">{route.orders.length} stops</div>
                                  <div className="w-1 h-1 rounded-full bg-stone-300" />
                                  <div className="flex items-center gap-1 text-xs text-stone-500">
                                    <Clock size={12} />
                                    <span>~{getEstimatedTime(route)}</span>
                                  </div>
                                  <div className="w-1 h-1 rounded-full bg-stone-300" />
                                  <div className={`text-xs font-bold uppercase tracking-wider ${route.status === 'completed' ? 'text-emerald-600' : 'text-orange-600'}`}>
                                    {route.status}
                                  </div>
                                </div>
                              </div>
                            </div>
                            <div className="flex gap-2">
                              {route.status === 'assigned' && (
                                <button 
                                  onClick={() => {
                                    setMapFocusDriverId(route.driverId);
                                    setView('map');
                                  }}
                                  className="px-4 py-2 bg-emerald-50 text-emerald-600 rounded-xl text-xs font-medium hover:bg-emerald-600 hover:text-white transition-all flex items-center gap-2"
                                >
                                  <Navigation size={14} />
                                  Track Live
                                </button>
                              )}
                              <a 
                                href={mapUrl}
                                target="_blank"
                                rel="noreferrer"
                                className="px-4 py-2 bg-stone-100 text-stone-600 rounded-xl text-xs font-medium hover:bg-emerald-600 hover:text-white transition-all flex items-center gap-2"
                              >
                                <ExternalLink size={14} />
                                View Map
                              </a>
                            </div>
                          </div>
                          <div className="flex gap-2 overflow-x-auto pb-2 scrollbar-hide">
                            {route.orders.map(order => (
                              <div key={order.id} className="flex-shrink-0 px-3 py-1.5 bg-stone-100 rounded-lg text-xs text-stone-600 border border-stone-200">
                                {order.destination || order.location}
                              </div>
                            ))}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              </section>

              {/* Drivers & Tracking */}
              <section className="space-y-8">
                <div className="bg-white p-6 rounded-3xl border border-stone-200 shadow-sm">
                  <h2 className="text-xl font-semibold mb-6">Active Drivers</h2>
                  <div className="space-y-4">
                    {drivers.map(driver => (
                      <div key={driver.id} className="p-4 bg-stone-50 rounded-2xl border border-stone-100">
                        <div className="flex justify-between items-start mb-2">
                          <div className="font-medium">{driver.name}</div>
                          <span className={`w-2 h-2 rounded-full ${driver.status === 'available' ? 'bg-emerald-500' : 'bg-orange-500'}`} />
                        </div>
                        <div className="flex justify-between items-center">
                          <div className="text-sm text-stone-500">{driver.vehicleType} • {driver.capacity}kg</div>
                          {locations[driver.id] && (
                            <button 
                              onClick={() => {
                                setMapFocusDriverId(driver.id);
                                setView('map');
                              }}
                              className="text-[10px] font-bold text-emerald-600 uppercase tracking-wider hover:underline"
                            >
                              Track Live
                            </button>
                          )}
                        </div>
                        {locations[driver.id] && (
                          <div className="text-xs text-emerald-600 font-medium flex items-center gap-1">
                            <Navigation size={12} />
                            Pincode: {locations[driver.id].pincode}
                          </div>
                        )}
                      </div>
                    ))}
                    <button 
                      onClick={() => setIsAddDriverModalOpen(true)}
                      className="w-full py-3 border-2 border-dashed border-stone-200 rounded-2xl text-stone-400 hover:text-emerald-600 hover:border-emerald-200 transition-all flex items-center justify-center gap-2"
                    >
                      <Plus size={20} />
                      Add Driver
                    </button>
                  </div>
                </div>

                <div className="bg-emerald-900 text-white p-8 rounded-3xl shadow-xl relative overflow-hidden">
                  <div className="relative z-10">
                    <h3 className="text-lg font-medium mb-1 opacity-80">Profit Forecast</h3>
                    <div className="text-4xl font-bold mb-4">₹{calculateProfit().profit.toLocaleString()}</div>
                    <div className="space-y-2">
                      <div className="flex justify-between text-sm opacity-70">
                        <span>Revenue</span>
                        <span>₹{calculateProfit().revenue.toLocaleString()}</span>
                      </div>
                      <div className="flex justify-between text-sm opacity-70">
                        <span>Est. Costs</span>
                        <span>₹{calculateProfit().cost.toLocaleString()}</span>
                      </div>
                    </div>
                    <div className="mt-6 pt-4 border-t border-emerald-800 flex items-center gap-2 text-emerald-300 text-sm">
                      <TrendingUp size={16} />
                      Based on {orders.length} orders and {routes.length} active routes
                    </div>
                  </div>
                  <div className="absolute -right-8 -bottom-8 w-32 h-32 bg-emerald-800 rounded-full blur-3xl opacity-50" />
                </div>
              </section>
            </div>
          </div>
        ) : view === 'settings' ? (
          <div className="p-8 max-w-2xl mx-auto">
            <header className="mb-12">
              <h1 className="text-3xl font-bold mb-2">Settings</h1>
              <p className="text-stone-500">Configure your initial location and system preferences</p>
            </header>
            
            <div className="bg-white p-8 rounded-3xl border border-stone-200 shadow-sm space-y-6">
              <h2 className="text-xl font-semibold flex items-center gap-2">
                <MapPin className="text-emerald-600" />
                Starting Location
              </h2>
              
              <div className="space-y-4">
                <div>
                  <label className="block text-sm font-medium text-stone-700 mb-1">Location Name</label>
                  <input 
                    type="text" 
                    value={settings?.locationName || ''}
                    onChange={(e) => setSettings(prev => ({ ...(prev || { locationName: '', address: '', pincode: '' }), locationName: e.target.value }))}
                    className="w-full p-3 bg-stone-50 border border-stone-200 rounded-xl outline-none focus:ring-2 focus:ring-emerald-500"
                    placeholder="e.g. Main Warehouse"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-stone-700 mb-1">Address</label>
                  <input 
                    type="text" 
                    value={settings?.address || ''}
                    onChange={(e) => setSettings(prev => ({ ...(prev || { locationName: '', address: '', pincode: '' }), address: e.target.value }))}
                    className="w-full p-3 bg-stone-50 border border-stone-200 rounded-xl outline-none focus:ring-2 focus:ring-emerald-500"
                    placeholder="e.g. Karol Bagh, Delhi"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-stone-700 mb-1">Pincode</label>
                  <input 
                    type="text" 
                    value={settings?.pincode || ''}
                    onChange={(e) => setSettings(prev => ({ ...(prev || { locationName: '', address: '', pincode: '' }), pincode: e.target.value }))}
                    className="w-full p-3 bg-stone-50 border border-stone-200 rounded-xl outline-none focus:ring-2 focus:ring-emerald-500"
                    placeholder="e.g. 110005"
                  />
                </div>
              </div>
              
              <button 
                onClick={async () => {
                  try {
                    const res = await fetch('/api/settings', {
                      method: 'POST',
                      headers: { 'Content-Type': 'application/json' },
                      body: JSON.stringify(settings)
                    });
                    if (res.ok) {
                      const savedSettings = await res.json();
                      setSettings(savedSettings);
                      setStatusMessage({ text: "Settings saved successfully", type: 'success' });
                    } else {
                      setStatusMessage({ text: "Failed to save settings", type: 'error' });
                    }
                  } catch (err) {
                    setStatusMessage({ text: "Error saving settings", type: 'error' });
                  }
                  setTimeout(() => setStatusMessage(null), 3000);
                }}
                className="w-full py-4 bg-emerald-600 text-white rounded-2xl font-bold shadow-lg shadow-emerald-100"
              >
                Save Settings
              </button>
            </div>
          </div>
        ) : view === 'drivers' ? (
          <div className="p-8 max-w-4xl mx-auto">
            <header className="flex justify-between items-end mb-12">
              <div>
                <h1 className="text-3xl font-bold mb-2">Driver Management</h1>
                <p className="text-stone-500">Manage your fleet and track driver status</p>
              </div>
              <button 
                onClick={() => setIsAddDriverModalOpen(true)}
                className="px-6 py-3 bg-emerald-600 text-white rounded-xl font-medium shadow-lg shadow-emerald-100 flex items-center gap-2"
              >
                <Plus size={20} />
                Add New Driver
              </button>
            </header>

            <div className="grid gap-6">
              {drivers.map(driver => (
                <div key={driver.id} className="bg-white p-6 rounded-3xl border border-stone-200 shadow-sm flex justify-between items-center">
                  <div className="flex items-center gap-4">
                    <div className="w-12 h-12 bg-stone-100 rounded-2xl flex items-center justify-center text-stone-600">
                      <User size={24} />
                    </div>
                    <div>
                      <h3 className="font-bold text-lg">{driver.name}</h3>
                      <p className="text-stone-500 text-sm">{driver.phone} • {driver.vehicleNumber}</p>
                    </div>
                  </div>
                  <div className="text-right">
                    <div className="text-sm font-medium text-stone-700">{driver.vehicleType}</div>
                    <div className="flex items-center gap-2 text-xs text-stone-500 mt-1">
                      <MapPin size={12} />
                      {driver.currentLocation || 'Unknown'}
                    </div>
                  </div>
                  <div className={`px-4 py-1.5 rounded-full text-xs font-bold uppercase tracking-wider ${
                    driver.status === 'available' ? 'bg-emerald-100 text-emerald-700' : 'bg-orange-100 text-orange-700'
                  }`}>
                    {driver.status}
                  </div>
                </div>
              ))}
            </div>
          </div>
        ) : view === 'driver' ? (
          <div className="p-8 max-w-2xl mx-auto">
             <header className="mb-12">
                <h1 className="text-3xl font-bold mb-2">Driver Portal</h1>
                <p className="text-stone-500">Select your profile to view assigned routes</p>
             </header>

             {!activeDriverId ? (
               <div className="grid gap-4">
                 {drivers.map(d => (
                   <button 
                    key={d.id}
                    onClick={() => setActiveDriverId(d.id)}
                    className="p-6 bg-white rounded-3xl border border-stone-200 text-left hover:border-emerald-500 transition-all group"
                   >
                     <div className="flex justify-between items-center">
                       <div>
                         <div className="font-semibold text-lg">{d.name}</div>
                         <div className="text-stone-500">{d.vehicleType}</div>
                       </div>
                       <div className="w-10 h-10 rounded-full bg-stone-50 flex items-center justify-center group-hover:bg-emerald-50 group-hover:text-emerald-600 transition-all">
                         <User size={20} />
                       </div>
                     </div>
                   </button>
                 ))}
               </div>
             ) : (
               <div className="space-y-8">
                 <button 
                  onClick={() => setActiveDriverId(null)}
                  className="text-stone-500 hover:text-emerald-600 flex items-center gap-2"
                 >
                   ← Back to Selection
                 </button>

                 <div className="bg-white p-8 rounded-3xl border border-stone-200 shadow-sm">
                    <div className="flex justify-between items-center mb-6">
                      <h2 className="text-2xl font-bold flex items-center gap-3">
                        <Clock className="text-emerald-600" />
                        Today's Route
                        {isTracking && (
                          <span className="flex h-3 w-3 relative">
                            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
                            <span className="relative inline-flex rounded-full h-3 w-3 bg-emerald-500"></span>
                          </span>
                        )}
                      </h2>
                      <div className="flex items-center gap-4">
                        <div className="flex flex-col items-end">
                          <span className="text-[10px] font-bold uppercase text-stone-400 tracking-wider">Live Tracking</span>
                          <button 
                            onClick={() => setIsTracking(!isTracking)}
                            className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors focus:outline-none ${isTracking ? 'bg-emerald-500' : 'bg-stone-200'}`}
                          >
                            <span className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${isTracking ? 'translate-x-6' : 'translate-x-1'}`} />
                          </button>
                        </div>
                      </div>
                    </div>

                    {(() => {
                      const route = routes.find(r => r.driverId === activeDriverId && r.status === 'assigned');
                      if (route) {
                        const waypoints = route.orders.map(o => encodeURIComponent(o.location || o.destination || '')).join('|');
                        const startLoc = settings?.pincode || settings?.address || 'Karol Bagh, Delhi';
                        const encodedStart = encodeURIComponent(startLoc);
                        const mapUrl = `https://www.google.com/maps/dir/?api=1&origin=${encodedStart}&destination=${encodedStart}&waypoints=${waypoints}`;
                        
                        return (
                          <a 
                            href={mapUrl}
                            target="_blank"
                            rel="noreferrer"
                            className="mb-8 w-full py-4 bg-emerald-50 text-emerald-700 rounded-2xl font-bold border border-emerald-100 flex items-center justify-center gap-2 hover:bg-emerald-100 transition-all"
                          >
                            <Navigation size={20} />
                            Open Full Route in Maps
                          </a>
                        );
                      }
                      return null;
                    })()}
                    
                    <div className="space-y-8 relative">
                     <div className="absolute left-4 top-8 bottom-8 w-0.5 bg-stone-100" />
                     
                     <div className="relative pl-12">
                        <div className="absolute left-2.5 top-1.5 w-3.5 h-3.5 rounded-full bg-emerald-600 border-4 border-white shadow-sm" />
                        <div className="font-semibold">Shop Pickup</div>
                        <div className="text-sm text-stone-500">Base Location</div>
                     </div>

                     {routes.filter(r => r.driverId === activeDriverId).map(route => (
                       route.orders.map((order, idx) => (
                         <div key={order.id} className="relative pl-12">
                            <div className="absolute left-2.5 top-1.5 w-3.5 h-3.5 rounded-full bg-stone-300 border-4 border-white shadow-sm" />
                            <div className="flex justify-between items-start">
                              <div>
                                <div className="text-xs text-stone-500 mb-1">Destination</div>
                                <div className="font-semibold">{order.destination || order.location}</div>
                                <div className="text-sm text-stone-500">{order.itemName} (x{order.quantity})</div>
                              </div>
                              <a 
                                href={`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(order.destination || order.location || '')}`}
                                target="_blank"
                                rel="noreferrer"
                                className="p-2 bg-emerald-50 text-emerald-600 rounded-lg"
                              >
                                <Navigation size={18} />
                              </a>
                            </div>
                         </div>
                       ))
                     ))}

                     <div className="relative pl-12">
                        <div className="absolute left-2.5 top-1.5 w-3.5 h-3.5 rounded-full bg-stone-100 border-4 border-white shadow-sm" />
                        <div className="font-semibold text-stone-400">Return to Shop</div>
                     </div>
                   </div>

                   <button 
                     onClick={() => {
                       if (activeDriverId && socketRef.current) {
                         const driver = drivers.find(d => d.id === activeDriverId);
                         socketRef.current.emit('route:complete', { 
                           driverId: activeDriverId, 
                           driverName: driver?.name || 'Unknown' 
                         });
                         setStatusMessage({ text: "Route marked as complete!", type: 'success' });
                         setTimeout(() => setStatusMessage(null), 3000);
                       }
                     }}
                     className="w-full mt-12 py-4 bg-emerald-600 text-white rounded-2xl font-bold shadow-lg shadow-emerald-100 flex items-center justify-center gap-2"
                   >
                     <CheckCircle2 size={20} />
                     Complete Route
                   </button>
                 </div>
               </div>
             )}
          </div>
          ) : null}

        {/* Add Driver Modal */}
        <AnimatePresence>
          {isAddDriverModalOpen && (
            <div className="fixed inset-0 z-[110] flex items-center justify-center p-4 bg-black/40 backdrop-blur-sm">
              <motion.div 
                initial={{ opacity: 0, scale: 0.95 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, scale: 0.95 }}
                className="bg-white w-full max-w-md rounded-3xl shadow-2xl overflow-hidden"
              >
                <div className="p-8">
                  <h2 className="text-2xl font-bold mb-6">Add New Driver</h2>
                  <div className="space-y-4">
                    <div>
                      <label className="block text-sm font-medium text-stone-700 mb-1">Full Name *</label>
                      <input 
                        type="text" 
                        value={newDriver.name}
                        onChange={(e) => setNewDriver(prev => ({ ...prev, name: e.target.value }))}
                        className="w-full p-3 bg-stone-50 border border-stone-200 rounded-xl outline-none focus:ring-2 focus:ring-emerald-500"
                        placeholder="e.g. Rohan Singh"
                      />
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-stone-700 mb-1">Phone Number *</label>
                      <input 
                        type="text" 
                        value={newDriver.phone}
                        onChange={(e) => setNewDriver(prev => ({ ...prev, phone: e.target.value }))}
                        className="w-full p-3 bg-stone-50 border border-stone-200 rounded-xl outline-none focus:ring-2 focus:ring-emerald-500"
                        placeholder="e.g. 9876543210"
                      />
                    </div>
                    <div className="grid grid-cols-2 gap-4">
                      <div>
                        <label className="block text-sm font-medium text-stone-700 mb-1">Vehicle Type</label>
                        <input 
                          type="text" 
                          value={newDriver.vehicleType}
                          onChange={(e) => setNewDriver(prev => ({ ...prev, vehicleType: e.target.value }))}
                          className="w-full p-3 bg-stone-50 border border-stone-200 rounded-xl outline-none focus:ring-2 focus:ring-emerald-500"
                          placeholder="e.g. Tata Ace"
                        />
                      </div>
                      <div>
                        <label className="block text-sm font-medium text-stone-700 mb-1">Vehicle Number</label>
                        <input 
                          type="text" 
                          value={newDriver.vehicleNumber}
                          onChange={(e) => setNewDriver(prev => ({ ...prev, vehicleNumber: e.target.value }))}
                          className="w-full p-3 bg-stone-50 border border-stone-200 rounded-xl outline-none focus:ring-2 focus:ring-emerald-500"
                          placeholder="e.g. DL 1S AB 1234"
                        />
                      </div>
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-stone-700 mb-1">Initial Location (Pincode)</label>
                      <input 
                        type="text" 
                        value={newDriver.currentLocation}
                        onChange={(e) => setNewDriver(prev => ({ ...prev, currentLocation: e.target.value }))}
                        className="w-full p-3 bg-stone-50 border border-stone-200 rounded-xl outline-none focus:ring-2 focus:ring-emerald-500"
                        placeholder="e.g. 110005"
                      />
                    </div>
                  </div>
                  <div className="flex gap-4 mt-8">
                    <button 
                      onClick={() => setIsAddDriverModalOpen(false)}
                      className="flex-1 py-3 bg-stone-100 text-stone-600 rounded-xl font-bold hover:bg-stone-200 transition-all"
                    >
                      Cancel
                    </button>
                    <button 
                      onClick={handleAddDriver}
                      className="flex-1 py-3 bg-emerald-600 text-white rounded-xl font-bold shadow-lg shadow-emerald-100 hover:bg-emerald-700 transition-all"
                    >
                      Add Driver
                    </button>
                  </div>
                </div>
              </motion.div>
            </div>
          )}
        </AnimatePresence>
      </main>
    </div>
  );
};

export default App;
