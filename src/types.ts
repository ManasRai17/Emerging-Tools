export interface Order {
  id: string;
  itemName?: string;
  item?: string;
  quantity: number;
  unit: string;
  location?: string;
  destination?: string;
  value?: number;
  price?: number;
  unitPrice?: number;
  priority?: 'Low' | 'Normal' | 'Urgent' | 'Emergency' | string;
  deadline?: string;
  status?: 'pending' | 'assigned' | 'delivered' | 'NORMAL' | string;
  selected?: boolean;
  score?: number;
}

export interface Driver {
  id: string;
  name: string;
  phone: string;
  vehicleNumber: string;
  vehicleType: string;
  capacity: number;
  currentLocation: string;
  status: 'available' | 'busy' | 'offline';
}

export interface AppSettings {
  locationName: string;
  address: string;
  pincode: string;
}

export interface Route {
  id: string;
  driverId: string;
  orders: Order[];
  status: 'assigned' | 'in-progress' | 'completed';
  timestamp: string;
}

export interface DriverLocation {
  driverId: string;
  pincode: string;
  lastUpdate: number;
}
