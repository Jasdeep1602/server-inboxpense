export const defaultCategories = [
  // --- Food & Dining ---
  {
    name: 'Groceries',
    icon: 'ShoppingCart',
    color: '#22c55e',
    matchStrings: ['grocery', 'grofers', 'bigbasket', 'blinkit', 'zepto'],
    isDefault: true,
  },
  {
    name: 'Restaurants',
    icon: 'UtensilsCrossed',
    color: '#f97316',
    matchStrings: ['restaurant', 'eatsure', 'kfc', 'mcdonalds', 'pizzahut'],
    isDefault: true,
  },
  {
    name: 'Coffee Shops',
    icon: 'Coffee',
    color: '#a16207',
    matchStrings: ['starbucks', 'cafe coffee day', 'chaayos'],
    isDefault: true,
  },
  {
    name: 'Food Delivery',
    icon: 'Bike',
    color: '#ef4444',
    matchStrings: ['zomato', 'swiggy'],
    isDefault: true,
  },

  // --- Bills & Utilities ---
  {
    name: 'Phone Bill',
    icon: 'Smartphone',
    color: '#3b82f6',
    matchStrings: ['airtel bill', 'jio bill', 'vi bill', 'postpaid'],
    isDefault: true,
  },
  {
    name: 'Internet Bill',
    icon: 'Wifi',
    color: '#6366f1',
    matchStrings: ['broadband', 'wifi', 'act fibernet', 'hathway'],
    isDefault: true,
  },
  {
    name: 'Electricity Bill',
    icon: 'Zap',
    color: '#facc15',
    matchStrings: ['electricity', 'bses', 'power bill'],
    isDefault: true,
  },
  {
    name: 'Gas Bill',
    icon: 'Flame',
    color: '#f59e0b',
    matchStrings: ['gas bill', 'igl', 'adani gas'],
    isDefault: true,
  },
  {
    name: 'Water Bill',
    icon: 'Droplets',
    color: '#0ea5e9',
    matchStrings: ['water bill', 'jal board'],
    isDefault: true,
  },
  {
    name: 'Rent',
    icon: 'Home',
    color: '#14b8a6',
    matchStrings: ['rent', 'nobroker'],
    isDefault: true,
  },
  {
    name: 'Subscriptions',
    icon: 'Repeat',
    color: '#d946ef',
    matchStrings: [
      'netflix',
      'spotify',
      'hotstar',
      'prime video',
      'subscription',
    ],
    isDefault: true,
  },

  // --- Transportation ---
  {
    name: 'Fuel',
    icon: 'Fuel',
    color: '#6b7280',
    matchStrings: ['fuel', 'petrol', 'diesel', 'ioc', 'bharat petroleum'],
    isDefault: true,
  },
  {
    name: 'Ride Sharing',
    icon: 'Car',
    color: '#14b8a6',
    matchStrings: ['uber', 'ola', 'rapido'],
    isDefault: true,
  },
  {
    name: 'Public Transport',
    icon: 'Bus',
    color: '#8b5cf6',
    matchStrings: ['metro', 'bus', 'dtc'],
    isDefault: true,
  },
  {
    name: 'Parking',
    icon: 'ParkingCircle',
    color: '#78716c',
    matchStrings: ['parking'],
    isDefault: true,
  },

  // --- Shopping ---
  {
    name: 'Clothing',
    icon: 'Shirt',
    color: '#ec4899',
    matchStrings: ['myntra', 'ajio', 'trends', 'lifestyle', 'zara', 'h&m'],
    isDefault: true,
  },
  {
    name: 'Electronics',
    icon: 'Laptop',
    color: '#6366f1',
    matchStrings: ['croma', 'reliance digital', 'apple', 'samsung'],
    isDefault: true,
  },
  {
    name: 'Home Goods',
    icon: 'Lamp',
    color: '#a16207',
    matchStrings: ['ikea', 'home centre', 'pepperfry'],
    isDefault: true,
  },
  {
    name: 'Hobbies',
    icon: 'Paintbrush',
    color: '#0ea5e9',
    matchStrings: ['hobby'],
    isDefault: true,
  },
  {
    name: 'General Shopping',
    icon: 'ShoppingBag',
    color: '#d946ef',
    matchStrings: ['amazon', 'flipkart', 'shopping'],
    isDefault: true,
  },

  // --- Health & Wellness ---
  {
    name: 'Doctor',
    icon: 'Stethoscope',
    color: '#ef4444',
    matchStrings: ['doctor', 'clinic', 'consultation'],
    isDefault: true,
  },
  {
    name: 'Pharmacy',
    icon: 'Pill',
    color: '#22c55e',
    matchStrings: ['pharmacy', 'apollo', 'pharmeasy', 'netmeds', 'medicine'],
    isDefault: true,
  },
  {
    name: 'Hospital',
    icon: 'Hospital',
    color: '#dc2626',
    matchStrings: ['hospital', 'max healthcare', 'fortis'],
    isDefault: true,
  },
  {
    name: 'Health Insurance',
    icon: 'ShieldCheck',
    color: '#1d4ed8',
    matchStrings: ['health insurance', 'max bupa', 'star health'],
    isDefault: true,
  },
  {
    name: 'Fitness',
    icon: 'Dumbbell',
    color: '#f97316',
    matchStrings: ['gym', 'cult.fit', 'fitness'],
    isDefault: true,
  },

  // --- Personal Care ---
  {
    name: 'Haircut',
    icon: 'Scissors',
    color: '#7c3aed',
    matchStrings: ['salon', 'barber', 'haircut'],
    isDefault: true,
  },
  {
    name: 'Personal Items',
    icon: 'Sparkles',
    color: '#ec4899',
    matchStrings: ['personal care', 'nykaa', 'sephora'],
    isDefault: true,
  },

  // --- Entertainment ---
  {
    name: 'Movies',
    icon: 'Film',
    color: '#f43f5e',
    matchStrings: ['bookmyshow', 'pvr', 'inox', 'cinepolis', 'movie ticket'],
    isDefault: true,
  },
  {
    name: 'Games',
    icon: 'Gamepad2',
    color: '#8b5cf6',
    matchStrings: ['game', 'steam', 'playstation'],
    isDefault: true,
  },
  {
    name: 'Events & Concerts',
    icon: 'Ticket',
    color: '#d946ef',
    matchStrings: ['concert', 'event'],
    isDefault: true,
  },

  // --- Finances ---
  {
    name: 'Investments',
    icon: 'TrendingUp',
    color: '#16a34a',
    matchStrings: ['sip', 'zerodha', 'groww', 'invest'],
    isDefault: true,
  },
  {
    name: 'Loan Payment',
    icon: 'Landmark',
    color: '#ca8a04',
    matchStrings: ['loan', 'emi'],
    isDefault: true,
  },
  {
    name: 'Taxes',
    icon: 'FileSpreadsheet',
    color: '#78716c',
    matchStrings: ['tax', 'gst', 'income tax'],
    isDefault: true,
  },

  // --- Family & Friends ---
  {
    name: 'Pets',
    icon: 'Dog',
    color: '#a16207',
    matchStrings: ['pet', 'vet', 'pet food'],
    isDefault: true,
  },
  {
    name: 'Kids',
    icon: 'Baby',
    color: '#2563eb',
    matchStrings: ['kids', 'toys', 'school fee'],
    isDefault: true,
  },
  {
    name: 'Gifts',
    icon: 'Gift',
    color: '#db2777',
    matchStrings: ['gift'],
    isDefault: true,
  },

  // --- Travel ---
  {
    name: 'Flights',
    icon: 'Plane',
    color: '#0ea5e9',
    matchStrings: ['indigo', 'vistara', 'airindia', 'flight'],
    isDefault: true,
  },
  {
    name: 'Hotels',
    icon: 'BedDouble',
    color: '#1d4ed8',
    matchStrings: ['hotel', 'makemytrip', 'goibibo', 'booking.com'],
    isDefault: true,
  },

  // --- Other ---
  {
    name: 'Education',
    icon: 'GraduationCap',
    color: '#6d28d9',
    matchStrings: ['education', 'udemy', 'coursera'],
    isDefault: true,
  },
  {
    name: 'Donations',
    icon: 'Heart',
    color: '#e11d48',
    matchStrings: ['donation', 'charity'],
    isDefault: true,
  },
  {
    name: 'Other',
    icon: 'MoreHorizontal',
    color: '#6b7280',
    matchStrings: [],
    isDefault: true,
  },
];
