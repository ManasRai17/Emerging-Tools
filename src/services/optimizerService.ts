import { Client, DistanceMatrixResponseData } from "@googlemaps/google-maps-services-js";

const client = new Client({});

interface Order {
  id: string;
  location: string;
  [key: string]: any;
}

interface Driver {
  id: string;
  [key: string]: any;
}

interface Route {
  id: string;
  driverId: string;
  orders: Order[];
  status: string;
  timestamp: string;
}

export async function optimizeRoutesNode(
  shopLocation: string,
  orders: Order[],
  drivers: Driver[],
  apiKey: string
): Promise<Route[]> {
  if (orders.length === 0 || drivers.length === 0) return [];

  // Calculate scores and sort orders by priority
  const priorityWeights: Record<string, number> = {
    'Low': 1,
    'Normal': 2,
    'Urgent': 3,
    'Emergency': 4
  };
  const PRIORITY_MULTIPLIER = 20;

  const scoredOrders = orders.map(o => ({
    ...o,
    score: (o.value || 0) + (priorityWeights[o.priority as keyof typeof priorityWeights] || 0) * PRIORITY_MULTIPLIER
  })).sort((a, b) => (b.score || 0) - (a.score || 0));

  const locations = [shopLocation, ...scoredOrders.map(o => o.location)];
  
  try {
    // 1. Get Distance Matrix
    const response = await client.distancematrix({
      params: {
        origins: locations,
        destinations: locations,
        key: apiKey,
        mode: "driving" as any
      }
    });

    const matrix = response.data.rows.map(row => 
      row.elements.map(el => el.distance?.value || 0)
    );

    // 2. Clarke-Wright Savings Algorithm
    const numOrders = scoredOrders.length;
    const depotIdx = 0;
    
    // Initial routes: each order is its own route
    let routes: number[][] = Array.from({ length: numOrders }, (_, i) => [i + 1]);

    // Calculate savings
    const savings: { i: number; j: number; saving: number }[] = [];
    for (let i = 1; i <= numOrders; i++) {
      for (let j = i + 1; j <= numOrders; j++) {
        const s = matrix[depotIdx][i] + matrix[depotIdx][j] - matrix[i][j];
        savings.push({ i, j, saving: s });
      }
    }

    // Sort savings descending
    savings.sort((a, b) => b.saving - a.saving);

    // Capacity constraint (simple: max 5 orders per driver)
    const MAX_CAPACITY = 5;

    for (const s of savings) {
      const routeI = routes.find(r => r.includes(s.i));
      const routeJ = routes.find(r => r.includes(s.j));

      if (!routeI || !routeJ || routeI === routeJ) continue;

      // Check if they are at the ends
      const isIAtEnd = routeI[0] === s.i || routeI[routeI.length - 1] === s.i;
      const isJAtEnd = routeJ[0] === s.j || routeJ[routeJ.length - 1] === s.j;

      if (isIAtEnd && isJAtEnd && (routeI.length + routeJ.length <= MAX_CAPACITY)) {
        // Merge routes
        let newRoute: number[];
        if (routeI[routeI.length - 1] === s.i && routeJ[0] === s.j) {
          newRoute = [...routeI, ...routeJ];
        } else if (routeI[0] === s.i && routeJ[routeJ.length - 1] === s.j) {
          newRoute = [...routeJ, ...routeI];
        } else if (routeI[routeI.length - 1] === s.i && routeJ[routeJ.length - 1] === s.j) {
          newRoute = [...routeI, ...[...routeJ].reverse()];
        } else {
          newRoute = [[...routeI].reverse(), ...routeJ].flat();
        }

        routes = routes.filter(r => r !== routeI && r !== routeJ);
        routes.push(newRoute);
      }
    }

    // 3. Assign to drivers
    const finalAssignments: Route[] = [];
    const numDrivers = drivers.length;

    // Sort routes by length or total distance if needed, here we just take the top ones
    routes.slice(0, numDrivers).forEach((routeIndices, i) => {
      const driverOrders = routeIndices.map(idx => scoredOrders[idx - 1]);
      finalAssignments.push({
        id: `route-${Date.now()}-${i}`,
        driverId: drivers[i].id,
        orders: driverOrders,
        status: 'assigned',
        timestamp: new Date().toISOString()
      });
    });

    return finalAssignments;

  } catch (error) {
    console.error("Optimization Service Error:", error);
    throw error;
  }
}
