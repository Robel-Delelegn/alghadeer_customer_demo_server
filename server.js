/**
 * Express Server for Al Ghadeer Water Customer App
 * Handles Stripe payments and wallet management
 */

require("dotenv").config();
const express = require("express");
const cors = require("cors");
const bodyParser = require("body-parser");
const os = require("os");

// Validate Stripe key
const STRIPE_SECRET_KEY = process.env.STRIPE_SECRET_KEY;
if (!STRIPE_SECRET_KEY || STRIPE_SECRET_KEY === "sk_test_placeholder" || STRIPE_SECRET_KEY.includes("placeholder")) {
  console.warn("⚠️  WARNING: Stripe secret key is not configured or is using placeholder value!");
  console.warn("⚠️  Please set STRIPE_SECRET_KEY in your .env file");
  console.warn("⚠️  Get your keys from: https://dashboard.stripe.com/apikeys");
}

const stripe = require("stripe")(STRIPE_SECRET_KEY);

const app = express();
const PORT = process.env.PORT || 3000;
const path = require("path");

// Middleware
app.use(cors());
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));

// Serve static files from public/images directory
// Images can be accessed via: http://localhost:3000/images/filename.jpg
app.use("/images", express.static(path.join(__dirname, "public", "images")));

// In-memory wallet storage (in production, use a database)
const wallets = new Map();

// In-memory order storage (in production, use a database)
const orders = new Map();

// In-memory user storage (in production, use a database)
const users = new Map();

// In-memory temporary tokens and OTPs (in production, use Redis or similar)
const temporaryTokens = new Map(); // temporary_token -> { phone, name, otp, expiresAt, isSignUp }
const otpStore = new Map(); // phone -> { otp, expiresAt }

// Sample users for testing
const initializeSampleUsers = () => {
  users.set("user-001", {
    userId: "user-001",
    name: "Ahmed Ali",
    phone: "+971501234567",
  });
  users.set("user-002", {
    userId: "user-002",
    name: "Fatima Hassan",
    phone: "+971509876543",
  });
  users.set("user-003", {
    userId: "user-003",
    name: "Mohammed Ibrahim",
    phone: "+971507654321",
  });
};
initializeSampleUsers();

// Generate OTP (6 digits)
function generateOTP() {
  return Math.floor(100000 + Math.random() * 900000).toString();
}

// Generate temporary token
function generateTemporaryToken() {
  return "temp_" + Math.random().toString(36).substring(2, 15) + Math.random().toString(36).substring(2, 15);
}

// Generate permanent token
function generatePermanentToken() {
  return "perm_" + Math.random().toString(36).substring(2, 15) + Math.random().toString(36).substring(2, 15) + Date.now().toString(36);
}

// Generate user ID
function generateUserId() {
  return "user-" + Date.now().toString(36) + Math.random().toString(36).substring(2, 8);
}

/**
 * Generate sample orders for a user
 * This creates sample orders when a user first accesses orders
 */
function generateSampleOrdersForUser(userId) {
  // Check if user already has orders
  const existingOrders = Array.from(orders.values()).filter(
    (order) => order.userId === userId
  );
  
  if (existingOrders.length > 0) {
    return; // User already has orders
  }

  const now = new Date();
  
  // Sample orders for this user
  const sampleOrders = [
    {
      orderId: `ORD-${userId.slice(-6)}-001`,
      userId: userId,
      orderItems: [
        { id: "w19", name: "Bottled Water 19L", price: 12.0, quantity: 2, currency: "AED" },
        { id: "cooler", name: "Water Cooler", price: 350, quantity: 1, currency: "AED" },
      ],
      totalAmount: 430.1, // (12*2 + 350) * 1.15
      shippingDetails: {
        name: "Customer",
        address: "Delivery Address",
        contact: "+971 50 123 4567",
      },
      paymentMethod: "credit_card",
      status: "confirmed",
      createdAt: new Date(now.getTime() - 5 * 24 * 60 * 60 * 1000).toISOString(), // 5 days ago
      deliveryDate: new Date(now.getTime() + 2 * 24 * 60 * 60 * 1000).toISOString(), // 2 days from now
    },
    {
      orderId: `ORD-${userId.slice(-6)}-002`,
      userId: userId,
      orderItems: [
        { id: "w05", name: "Bottled Water 5L", price: 6.0, quantity: 4, currency: "AED" },
      ],
      totalAmount: 27.6, // (6*4) * 1.15
      shippingDetails: {
        name: "Customer",
        address: "Delivery Address",
        contact: "+971 50 123 4567",
      },
      paymentMethod: "cash_on_delivery",
      status: "delivered",
      deliveryDate: new Date(now.getTime() - 3 * 24 * 60 * 60 * 1000).toISOString(), // 3 days ago
    },
    {
      orderId: `ORD-${userId.slice(-6)}-003`,
      userId: userId,
      orderItems: [
        { id: "family-pack", name: "Family Pack", price: 420, quantity: 1, currency: "AED" },
      ],
      totalAmount: 483.0, // 420 * 1.15
      shippingDetails: {
        name: "Customer",
        address: "Delivery Address",
        contact: "+971 50 123 4567",
      },
      paymentMethod: "wallet",
      status: "pending",
      deliveryDate: new Date(now.getTime() - 1 * 24 * 60 * 60 * 1000).toISOString(), // 1 day ago
    },
  ];

  // Add sample orders to storage
  sampleOrders.forEach((order) => {
    orders.set(order.orderId, order);
  });
}

/**
 * Initialize wallet for a user
 */
function getOrCreateWallet(userId) {
  if (!wallets.has(userId)) {
    wallets.set(userId, {
      userId,
      balance: 0,
      currency: "AED",
      transactions: [],
    });
  }
  return wallets.get(userId);
}

/**
 * Health check endpoint
 */
app.get("/health", (req, res) => {
  res.json({ status: "ok", message: "Server is running" });
});

/**
 * Dummy products data
 */
const dummyProducts = {
  "Drinking waters": [
    {
      id: "200ml-cup",
      name: "200ml Cup",
      price: 7.35,
      image_url: "https://www.alghadeerwater.com/lovable-uploads/e97e8c8a-a180-42e5-b588-5013648484bb.png",
      description: "Premium quality drinking water in a convenient 200ml cup. Perfect for on-the-go hydration with BPA-free materials.",
      category: "Drinking Water"
    },
    {
      id: "200ml-bottle-30",
      name: "200ml Bottle",
      price: 10.5,
      image_url: "https://images.unsplash.com/photo-1698664434322-94a43b98b9ba?q=80&w=765&auto=format&fit=crop&ixlib=rb-4.1.0&ixid=M3wxMjA3fDB8MHxwaG90by1wYWdlfHx8fGVufDB8fHx8fA%3D%3D",
      description: "Compact 200ml bottle ideal for daily hydration. Made with eco-friendly materials.",
      category: "Drinking Water"
    },
    {
      id: "330ml-bottle-12",
      name: "330ml Bottle",
      price: 5.25,
      image_url: "https://www.alghadeerwater.com/lovable-uploads/46c6c613-4f2b-4bc0-8e8e-b20545592e93.png",
      description: "Standard 330ml bottle of premium purified water. Great value for everyday use.",
      category: "Drinking Water"
    },
    {
      id: "500ml-bottle-12",
      name: "500ml Bottle",
      price: 5.25,
      image_url: "https://encrypted-tbn0.gstatic.com/images?q=tbn:ANd9GcRYjjcwgr-oWl6b3iTio1sYOj-Y-iB5RHfOzQ&s",
      description: "500ml bottle of pure drinking water. Perfect size for work or travel.",
      category: "Drinking Water"
    },
    {
      id: "w19",
      name: "Bottled Water 19L",
      price: 12.0,
      image_url: "https://encrypted-tbn0.gstatic.com/images?q=tbn:ANd9GcRB8Ozlj1C0ndAc2SmXnKckp99URIGms7nvHw&s",
      description: "Large 19-liter bottle for home or office use. Premium quality water delivered fresh.",
      category: "Drinking Water"
    },
    {
      id: "w05",
      name: "Bottled Water 5L",
      price: 6.0,
      image_url: "https://encrypted-tbn0.gstatic.com/images?q=tbn:ANd9GcRHNxKaqhMnBJGK8ccZvgv65-SMZUQn84vpNg&s",
      description: "Convenient 5-liter bottle. Ideal for small families or single households.",
      category: "Drinking Water"
    }
  ],
  "Accessories": [
    {
      id: "cooler",
      name: "Water Cooler",
      price: 350,
      image_url: "https://www.alghadeerwater.com/lovable-uploads/33ae9524-aa29-4945-a1a0-90d4e13adccd.png",
      description: "Premium water cooler with hot and cold water dispensing. Modern design with energy-efficient operation.",
      category: "Accessories"
    },
    {
      id: "kitchen-dispenser",
      name: "Kitchen Dispenser",
      price: 40,
      image_url: "https://images.unsplash.com/photo-1544198841-10f34f31f8dd?q=80&w=687&auto=format&fit=crop&ixlib=rb-4.1.0&ixid=M3wxMjA3fDB8MHxwaG90by1wYWdlfHx8fGVufDB8fHx8fA%3D%3D",
      description: "Compact kitchen water dispenser. Easy to install and perfect for any kitchen space.",
      category: "Accessories"
    },
    {
      id: "manual-pump",
      name: "Manual Pump",
      price: 25,
      image_url: "https://plus.unsplash.com/premium_photo-1667516700355-4e153de39581?w=600&auto=format&fit=crop&q=60&ixlib=rb-4.1.0&ixid=M3wxMjA3fDB8MHxwaG90by1yZWxhdGVkfDEyfHx8ZW58MHx8fHx8",
      description: "Durable manual water pump. No electricity required, perfect for any location.",
      category: "Accessories"
    },
    {
      id: "disp",
      name: "Water Dispenser Rental",
      price: 30.0,
      image_url: "https://images.unsplash.com/photo-1593784991095-a205069470b6?w=300&h=300&fit=crop",
      description: "Monthly rental for premium water dispenser. Includes maintenance and service.",
      category: "Accessories"
    }
  ],
  "Special offers": [
    {
      id: "family-pack",
      name: "Family Pack",
      price: 420,
      originalPrice: 495,
      image_url: "https://www.alghadeerwater.com/lovable-uploads/d2973658-4577-4d76-834d-0259988c1eaf.png",
      description: "Cooler + 5 full bottles + coupon book + free 200ml carton. Best value for families. Everything you need to start your water delivery service.",
      category: "Special Offers",
      badge: "Best Value"
    },
    {
      id: "standard-pack",
      name: "Standard Pack",
      price: 380,
      originalPrice: 425,
      image_url: "https://www.alghadeerwater.com/assets/build-your-own-bundle-Cq1_iSCi.png",
      description: "Cooler + 3 full bottles + coupon book + free 200ml carton. Most popular starter package for new customers.",
      category: "Special Offers",
      badge: "Most Popular"
    },
    {
      id: "starter-pack",
      name: "Starter Pack",
      price: 125,
      originalPrice: 140,
      image_url: "https://www.alghadeerwater.com/lovable-uploads/36bdc5fe-0ba9-4c4d-a9f5-946184d4a039.png",
      description: "Manual pump + 3 full bottles + coupon book + free 200ml carton. Perfect for trying our service.",
      category: "Special Offers",
      badge: "Starter Pack"
    }
  ]
};

/**
 * Get subscription products (drinking water products for subscription)
 * GET /api/subscription-products
 */
app.get("/api/subscription-products", (req, res) => {
  try {
    // Return only drinking water products suitable for subscription (2 products: 19L and 5L)
    const subscriptionProducts = dummyProducts["Drinking waters"]
      .filter((product) => {
        // Filter for larger bottle sizes suitable for subscription (19L, 5L)
        return product.id === "w19" || product.id === "w05";
      })
      .map((product) => ({
        id: product.id,
        name: product.name,
        price: product.price,
        image_url: product.image_url,
        description: product.description,
        category: product.category,
      }));

    res.json({
      success: true,
      data: {
        products: subscriptionProducts,
      },
    });
  } catch (error) {
    console.error("Error fetching subscription products:", error);
    res.status(500).json({
      success: false,
      message: "Failed to fetch subscription products",
      error: error.message,
    });
  }
});

/**
 * Get products by category
 * GET /products/?customer_id=&customer_site_id=
 */
app.get("/api/products", (req, res) => {
  try {
    const { customer_id, customer_site_id } = req.query;
    
    // Validate query parameters (can be optional or required based on business logic)
    // For now, we'll log them but still return products
    
    res.json({
      success: true,
      data: {
        "drinking_waters": dummyProducts["Drinking waters"],
        "accessories": dummyProducts["Accessories"],
        "special_offers": dummyProducts["Special offers"]
      },
      meta: {
        customer_id: customer_id || null,
        customer_site_id: customer_site_id || null,
        total_products: 
          dummyProducts["Drinking waters"].length +
          dummyProducts["Accessories"].length +
          dummyProducts["Special offers"].length
      }
    });
  } catch (error) {
    console.error("Error fetching products:", error);
    res.status(500).json({
      success: false,
      message: "Failed to fetch products",
      error: error.message,
    });
  }
});

/**
 * Get wallet balance
 * GET /api/wallet/:userId
 */
app.get("/api/wallet/:userId", (req, res) => {
  try {
    const { userId } = req.params;
    const wallet = getOrCreateWallet(userId);
    res.json({
      success: true,
      data: {
        balance: wallet.balance,
        currency: wallet.currency,
      },
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: "Failed to fetch wallet balance",
      error: error.message,
    });
  }
});

/**
 * Create Stripe Payment Intent
 * POST /api/payments/create-intent
 * Supports both wallet refills and order payments
 */
app.post("/api/payments/create-intent", async (req, res) => {
  try {
    const { amount, currency = "AED", userId, orderItems, shippingDetails, orderType } = req.body;

    if (!amount || amount <= 0) {
      return res.status(400).json({
        success: false,
        message: "Invalid amount",
      });
    }

    if (!userId) {
      return res.status(400).json({
        success: false,
        message: "User ID is required",
      });
    }

    // Convert AED to cents (Stripe uses smallest currency unit)
    // AED doesn't have cents, so we multiply by 100 for consistency
    const amountInCents = Math.round(amount * 100);

    // Build metadata (only for reference, not used for logic)
    const metadata = {
      userId,
      orderType: orderType || (orderItems ? "purchase" : "refill"),
    };

    if (orderType === "purchase" || orderItems) {
      // Order payment - store details in metadata for reference
      metadata.orderAmount = amount.toString();
      if (orderItems) {
        metadata.orderItems = JSON.stringify(orderItems);
      }
      if (shippingDetails) {
        metadata.shippingDetails = JSON.stringify(shippingDetails);
      }
    } else {
      // Wallet refill
      metadata.refillAmount = amount.toString();
    }

    // Create Payment Intent
    const paymentIntent = await stripe.paymentIntents.create({
      amount: amountInCents,
      currency: currency.toLowerCase(),
      metadata,
      automatic_payment_methods: {
        enabled: true,
      },
    });

    res.json({
      success: true,
      data: {
        clientSecret: paymentIntent.client_secret,
        paymentIntentId: paymentIntent.id,
      },
    });
  } catch (error) {
    console.error("Error creating payment intent:", error);
    
    // Provide more helpful error messages
    let errorMessage = "Failed to create payment intent";
    let errorDetails = error.message;
    
    if (error.type === "StripeConnectionError" || error.code === "ECONNRESET") {
      errorMessage = "Cannot connect to Stripe. Please check your Stripe API key.";
      errorDetails = "Connection error: " + (error.message || "Network error");
      
      if (!STRIPE_SECRET_KEY || STRIPE_SECRET_KEY === "sk_test_placeholder") {
        errorMessage = "Stripe API key is not configured. Please set STRIPE_SECRET_KEY in your .env file.";
        errorDetails = "Get your keys from: https://dashboard.stripe.com/apikeys";
      }
    } else if (error.type === "StripeAuthenticationError") {
      errorMessage = "Invalid Stripe API key. Please check your STRIPE_SECRET_KEY.";
      errorDetails = "Authentication failed: " + (error.message || "Invalid credentials");
    } else if (error.type === "StripeInvalidRequestError") {
      errorMessage = "Invalid payment request";
      errorDetails = error.message || "Please check your payment details";
    }
    
    res.status(500).json({
      success: false,
      message: errorMessage,
      error: errorDetails,
      errorType: error.type || "UnknownError",
    });
  }
});

/**
 * Confirm payment and update wallet or create order
 * POST /api/payments/confirm
 * Handles both wallet refills and order payments
 */
app.post("/api/payments/confirm", async (req, res) => {
  try {
    const { paymentIntentId, userId, orderItems, shippingDetails, orderType } = req.body;

    if (!paymentIntentId || !userId) {
      return res.status(400).json({
        success: false,
        message: "Payment intent ID and user ID are required",
      });
    }

    // Retrieve payment intent from Stripe
    const paymentIntent = await stripe.paymentIntents.retrieve(paymentIntentId);

    if (paymentIntent.status !== "succeeded") {
      return res.status(400).json({
        success: false,
        message: `Payment not completed. Status: ${paymentIntent.status}`,
      });
    }

    // Determine order type from request body (explicit) or infer from context
    const paymentOrderType = orderType || (orderItems ? "purchase" : "refill");

    if (paymentOrderType === "purchase") {
      // Handle order payment
      if (!orderItems || orderItems.length === 0) {
        return res.status(400).json({
          success: false,
          message: "Order items are required for purchase",
        });
      }

      // Calculate order amount from items or use payment intent amount
      const orderAmount = orderItems.reduce(
        (sum, item) => sum + (item.price || 0) * (item.quantity || 0),
        0
      ) || paymentIntent.amount / 100; // Fallback to payment intent amount if calculation fails

      if (orderAmount <= 0) {
        return res.status(400).json({
          success: false,
          message: "Invalid order amount",
        });
      }

      // Create order
      const orderId = `ORD-${Date.now()}`;
      const order = {
        orderId,
        userId,
        orderItems: orderItems,
        totalAmount: orderAmount,
        shippingDetails: shippingDetails || {},
        paymentMethod: "credit_card",
        paymentIntentId,
        status: "confirmed",
        createdAt: new Date().toISOString(),
      };

      orders.set(orderId, order);

      res.json({
        success: true,
        data: {
          orderId,
          message: "Order confirmed successfully",
        },
      });
    } else {
      // Handle wallet refill
      // Get amount from payment intent (already verified) or use payment intent amount
      const refillAmount = paymentIntent.amount / 100; // Convert from cents to AED

      if (refillAmount <= 0) {
        return res.status(400).json({
          success: false,
          message: "Invalid refill amount",
        });
      }

      // Update wallet
      const wallet = getOrCreateWallet(userId);
      wallet.balance += refillAmount;
      wallet.transactions.push({
        id: paymentIntent.id,
        type: "refill",
        amount: refillAmount,
        timestamp: new Date().toISOString(),
        status: "completed",
      });

      res.json({
        success: true,
        data: {
          balance: wallet.balance,
          currency: wallet.currency,
          transactionId: paymentIntent.id,
        },
      });
    }
  } catch (error) {
    console.error("Error confirming payment:", error);
    res.status(500).json({
      success: false,
      message: "Failed to confirm payment",
      error: error.message,
    });
  }
});

/**
 * Webhook endpoint for Stripe events
 * POST /api/webhooks/stripe
 */
app.post("/api/webhooks/stripe", express.raw({ type: "application/json" }), async (req, res) => {
  const sig = req.headers["stripe-signature"];
  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET || "whsec_placeholder";

  let event;

  try {
    event = stripe.webhooks.constructEvent(req.body, sig, webhookSecret);
  } catch (err) {
    console.error("Webhook signature verification failed:", err.message);
    return res.status(400).send(`Webhook Error: ${err.message}`);
  }

  // Handle the event
  if (event.type === "payment_intent.succeeded") {
    const paymentIntent = event.data.object;
    const userId = paymentIntent.metadata.userId;
    const refillAmount = parseFloat(paymentIntent.metadata.refillAmount || "0");

    if (userId && refillAmount > 0) {
      const wallet = getOrCreateWallet(userId);
      wallet.balance += refillAmount;
      wallet.transactions.push({
        id: paymentIntent.id,
        type: "refill",
        amount: refillAmount,
        timestamp: new Date().toISOString(),
        status: "completed",
      });
      console.log(`Wallet updated for user ${userId}: +${refillAmount} ${wallet.currency}`);
    }
  }

  res.json({ received: true });
});

app.get("/api/wallet/:userId/transactions", (req, res) => {
  try {
    const { userId } = req.params;
    const wallet = getOrCreateWallet(userId);
    res.json({
      success: true,
      data: {
        transactions: wallet.transactions,
      },
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: "Failed to fetch transactions",
      error: error.message,
    });
  }
});

/**
 * Sample subscription data storage
 */
const subscriptions = new Map();

/**
 * Get or create subscription for user
 */
function getOrCreateSubscription(userId) {
  if (!subscriptions.has(userId)) {
    const now = new Date();
    subscriptions.set(userId, {
      active: true,
      planType: "Weekly",
      frequency: "Every Monday",
      quantity: 2,
      productName: "Bottled Water 19L",
      nextDelivery: new Date(now.getTime() + 3 * 24 * 60 * 60 * 1000).toISOString(), // 3 days from now
      deliveryAddress: "Villa 45, Al Khalidiyah, Abu Dhabi",
      contactNumber: "+971 50 123 4567",
      startDate: new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000).toISOString(), // Started 30 days ago
      paymentMethod: "credit_card", // Default payment method for subscription
    });
  }
  return subscriptions.get(userId);
}

/**
 * Calculate next delivery date based on subscription settings
 */
function calculateNextDelivery(subscriptionData) {
  const now = new Date();
  const startDate = subscriptionData.startImmediately 
    ? now 
    : subscriptionData.startDate 
      ? new Date(subscriptionData.startDate) 
      : now;

  // For simplicity, calculate next delivery as 3 days from now
  // In production, this would calculate based on deliveryDays and weeksInMonth
  const nextDelivery = new Date(now.getTime() + 3 * 24 * 60 * 60 * 1000);
  return nextDelivery.toISOString();
}

/**
 * Format delivery frequency string
 */
function formatFrequency(planType, deliveryDays, weeksInMonth) {
  const dayNames = {
    mon: "Monday",
    tue: "Tuesday",
    wed: "Wednesday",
    thu: "Thursday",
    fri: "Friday",
    sat: "Saturday",
    sun: "Sunday",
  };

  const days = deliveryDays.map((d) => dayNames[d] || d).join(", ");

  if (planType === "weekly") {
    return `Every ${days}`;
  } else if (planType === "monthly") {
    const weeks = weeksInMonth
      .map((w) => (w === "last" ? "last" : `${w}${w === 1 ? "st" : w === 2 ? "nd" : w === 3 ? "rd" : "th"}`))
      .join(", ");
    return `${days} (${weeks} week${weeksInMonth.length !== 1 ? "s" : ""} of month)`;
  } else {
    return `Custom: ${days}`;
  }
}

/**
 * Get user subscription deliveries (for orders page - subscription tab)
 * GET /api/user-subscription/:userId
 * Returns subscription deliveries in the same format as orders
 * NOTE: This must be defined BEFORE POST /api/subscriptions to avoid route conflicts
 */
app.get("/api/user-subscription/:userId", (req, res) => {
  try {
    const { userId } = req.params;

    // Get subscription info (create if doesn't exist)
    const subscription = getOrCreateSubscription(userId);

    // Return empty array if subscription is not active
    if (!subscription || !subscription.active) {
      return res.json({
        success: true,
        data: {
          orders: [],
        },
      });
    }

    // Generate subscription deliveries for this week based on subscription plan
    const now = new Date();
    const subscriptionDeliveries = [];
    
    // Calculate deliveries for the current week (next 7 days)
    const productPrice = 12.0; // Default price for Bottled Water 19L
    
    // Get next delivery date from subscription
    let nextDeliveryDate = subscription.nextDelivery 
      ? new Date(subscription.nextDelivery)
      : new Date(now.getTime() + 3 * 24 * 60 * 60 * 1000); // Default: 3 days from now
    
    // If nextDelivery is in the past or today, calculate the next occurrence
    if (nextDeliveryDate <= now) {
      // For weekly subscriptions, add 7 days
      if (subscription.planType === "Weekly") {
        const daysUntilNext = 7 - ((now.getDay() - nextDeliveryDate.getDay() + 7) % 7);
        nextDeliveryDate = new Date(now.getTime() + daysUntilNext * 24 * 60 * 60 * 1000);
      } else {
        // For other types, just add a week
        nextDeliveryDate = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);
      }
    }
    
    // Generate deliveries for the next 7 days
    // For weekly plans, generate only the next delivery within this week
    for (let i = 0; i < 7; i++) {
      const checkDate = new Date(now.getTime() + i * 24 * 60 * 60 * 1000);
      const checkDateStr = checkDate.toISOString().split('T')[0];
      const nextDeliveryStr = nextDeliveryDate.toISOString().split('T')[0];
      
      if (checkDateStr === nextDeliveryStr) {
        const deliveryId = `SUB-${userId.slice(-6)}-${Date.now()}-${i}`;
        subscriptionDeliveries.push({
          orderId: deliveryId,
          userId: userId,
          orderItems: [
            {
              id: "w19",
              name: subscription.productName || "Bottled Water 19L",
              price: productPrice,
              quantity: subscription.quantity || 1,
              currency: "AED",
            },
          ],
          totalAmount: productPrice * (subscription.quantity || 1) * 1.15, // Including VAT
          shippingDetails: {
            name: "Customer",
            address: subscription.deliveryAddress || "Delivery Address",
            contact: subscription.contactNumber || "+971 50 123 4567",
          },
          paymentMethod: subscription.paymentMethod || "credit_card",
          status: "confirmed",
          deliveryDate: nextDeliveryDate.toISOString(),
        });
        break; // Only generate one delivery per week for weekly plans
      }
    }
    
    // If no delivery found for this week, use the nextDelivery date
    if (subscriptionDeliveries.length === 0) {
      const deliveryId = `SUB-${userId.slice(-6)}-${Date.now()}`;
      subscriptionDeliveries.push({
        orderId: deliveryId,
        userId: userId,
        orderItems: [
          {
            id: "w19",
            name: subscription.productName || "Bottled Water 19L",
            price: productPrice,
            quantity: subscription.quantity || 1,
            currency: "AED",
          },
        ],
        totalAmount: productPrice * (subscription.quantity || 1) * 1.15,
        shippingDetails: {
          name: "Customer",
          address: subscription.deliveryAddress || "Delivery Address",
          contact: subscription.contactNumber || "+971 50 123 4567",
        },
        paymentMethod: subscription.paymentMethod || "credit_card",
        status: "confirmed",
        deliveryDate: nextDeliveryDate.toISOString(),
      });
    }

    // Sort by delivery date (earliest first)
    subscriptionDeliveries.sort(
      (a, b) => new Date(a.deliveryDate).getTime() - new Date(b.deliveryDate).getTime()
    );

    res.json({
      success: true,
      data: {
        orders: subscriptionDeliveries,
      },
    });
  } catch (error) {
    console.error("Error fetching subscription deliveries:", error);
    res.status(500).json({
      success: false,
      message: "Failed to fetch subscription deliveries",
      error: error.message,
    });
  }
});

/**
 * Create subscription
 * POST /api/subscriptions
 */
app.post("/api/subscriptions", async (req, res) => {
  try {
    const {
      userId,
      planType,
      startDate,
      startImmediately,
      deliveryDays,
      weeksInMonth,
      ongoing,
      numberOfWeeks,
      endDate,
      quantityPerDelivery,
      notes,
      remindersEnabled,
      paymentMethod,
      deliveryAddress,
      productId,
      productName,
    } = req.body;

    // Validate required fields
    if (!userId) {
      return res.status(400).json({
        success: false,
        message: "User ID is required",
      });
    }

    if (!planType || !["weekly", "monthly", "custom"].includes(planType)) {
      return res.status(400).json({
        success: false,
        message: "Valid plan type is required",
      });
    }

    if (!deliveryDays || deliveryDays.length === 0) {
      return res.status(400).json({
        success: false,
        message: "At least one delivery day is required",
      });
    }

    if ((planType === "monthly" || planType === "custom") && (!weeksInMonth || weeksInMonth.length === 0)) {
      return res.status(400).json({
        success: false,
        message: "At least one week in month is required for monthly/custom plans",
      });
    }

    if (!startImmediately && !startDate) {
      return res.status(400).json({
        success: false,
        message: "Start date is required if not starting immediately",
      });
    }

    // Calculate next delivery date
    const subscriptionData = {
      startImmediately,
      startDate,
    };
    const nextDelivery = calculateNextDelivery(subscriptionData);

    // Format frequency
    const frequency = formatFrequency(planType, deliveryDays, weeksInMonth || []);

    // Validate payment method if provided
    if (paymentMethod && !["credit_card", "cash_on_delivery", "wallet"].includes(paymentMethod)) {
      return res.status(400).json({
        success: false,
        message: "Invalid payment method. Must be credit_card, cash_on_delivery, or wallet",
      });
    }

    // Create subscription object
    const subscriptionId = `SUB-${Date.now()}`;
    const subscription = {
      subscriptionId,
      userId,
      planType: planType.charAt(0).toUpperCase() + planType.slice(1), // Capitalize
      frequency,
      quantity: quantityPerDelivery || 1,
      productName: productName || "Bottled Water 19L", // Use provided product name or default
      productId: productId || null, // Store product ID for reference
      nextDelivery,
      deliveryAddress: deliveryAddress || "Delivery Address", // Use provided address or default
      contactNumber: "+971 50 123 4567", // Should come from user profile or form
      startDate: startImmediately ? new Date().toISOString() : startDate,
      endDate: ongoing ? null : endDate,
      numberOfWeeks: ongoing ? null : numberOfWeeks,
      ongoing,
      deliveryDays,
      weeksInMonth: weeksInMonth || [],
      notes: notes || "",
      remindersEnabled: remindersEnabled !== false,
      active: true,
      paymentMethod: paymentMethod || "credit_card", // Default to credit_card if not provided
      createdAt: new Date().toISOString(),
    };

    // Store subscription (replace existing if any)
    subscriptions.set(userId, subscription);

    res.json({
      success: true,
      data: {
        subscriptionId,
        message: "Subscription created successfully",
      },
    });
  } catch (error) {
    console.error("Error creating subscription:", error);
    res.status(500).json({
      success: false,
      message: "Failed to create subscription",
      error: error.message,
    });
  }
});

/**
 * Get user pending orders (for My Orders tab)
 * GET /api/orders/:userId
 * Returns only pending/confirmed/processing orders (not delivered/completed)
 */
app.get("/api/orders/:userId", (req, res) => {
  try {
    const { userId } = req.params;

    // Generate sample orders for user if they don't have any
    generateSampleOrdersForUser(userId);

    // Get all orders for this user
    const userOrders = Array.from(orders.values()).filter(
      (order) => order.userId === userId
    );

    // Filter to only pending orders (pending, confirmed, processing)
    const pendingOrders = userOrders.filter(
      (order) => 
        order.status === "pending" || 
        order.status === "confirmed" || 
        order.status === "processing"
    );

    // Sort by creation date (newest first)
    pendingOrders.sort((a, b) => 
      new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
    );

    res.json({
      success: true,
      data: {
        orders: pendingOrders,
      },
    });
  } catch (error) {
    console.error("Error fetching orders:", error);
    res.status(500).json({
      success: false,
      message: "Failed to fetch orders",
      error: error.message,
    });
  }
});

/**
 * Get this week's next delivery with driver information
 * GET /api/this-week-deliveries/:userId
 * Returns the next delivery scheduled for this week with driver details
 */
app.get("/api/this-week-deliveries/:userId", (req, res) => {
  try {
    const { userId } = req.params;
    const now = new Date();
    
    // Sample driver data (in production, this would come from a database)
    const sampleDrivers = [
      {
        name: "Ahmed Al Mansoori",
        phone: "+971501234567",
      },
      {
        name: "Mohammed Al Zaabi",
        phone: "+971509876543",
      },
      {
        name: "Khalid Al Dhaheri",
        phone: "+971507654321",
      },
    ];
    
    // Get random driver for this delivery
    const driver = sampleDrivers[Math.floor(Math.random() * sampleDrivers.length)];
    
    // Check for subscription deliveries first
    const subscription = getOrCreateSubscription(userId);
    let nextDelivery = null;
    
    if (subscription && subscription.active) {
      // Get next delivery date from subscription
      let nextDeliveryDate = subscription.nextDelivery 
        ? new Date(subscription.nextDelivery)
        : new Date(now.getTime() + 3 * 24 * 60 * 60 * 1000);
      
      // If nextDelivery is in the past or today, calculate the next occurrence
      if (nextDeliveryDate <= now) {
        if (subscription.planType === "Weekly") {
          const daysUntilNext = 7 - ((now.getDay() - nextDeliveryDate.getDay() + 7) % 7);
          nextDeliveryDate = new Date(now.getTime() + daysUntilNext * 24 * 60 * 60 * 1000);
        } else {
          nextDeliveryDate = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);
        }
      }
      
      // Check if delivery is within this week (next 7 days)
      const weekFromNow = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);
      if (nextDeliveryDate <= weekFromNow) {
        // Set delivery time (default: 10:00 AM)
        nextDeliveryDate.setHours(10, 0, 0, 0);
        
        nextDelivery = {
          deliveryDate: nextDeliveryDate.toISOString(),
          deliveryTime: "10:00 AM",
          driverName: driver.name,
          driverPhone: driver.phone,
          type: "subscription",
          productName: subscription.productName || "Bottled Water 19L",
          quantity: subscription.quantity || 1,
        };
      }
    }
    
    // If no subscription delivery, check for one-time orders
    if (!nextDelivery) {
      generateSampleOrdersForUser(userId);
      const userOrders = Array.from(orders.values()).filter(
        (order) => order.userId === userId
      );
      
      // Find the next pending/confirmed order within this week
      const upcomingOrders = userOrders
        .filter((order) => 
          (order.status === "pending" || order.status === "confirmed" || order.status === "processing") &&
          order.deliveryDate &&
          new Date(order.deliveryDate) > now &&
          new Date(order.deliveryDate) <= new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000)
        )
        .sort((a, b) => new Date(a.deliveryDate).getTime() - new Date(b.deliveryDate).getTime());
      
      if (upcomingOrders.length > 0) {
        const order = upcomingOrders[0];
        const deliveryDate = new Date(order.deliveryDate);
        deliveryDate.setHours(10, 0, 0, 0);
        
        nextDelivery = {
          deliveryDate: deliveryDate.toISOString(),
          deliveryTime: "10:00 AM",
          driverName: driver.name,
          driverPhone: driver.phone,
          type: "one-time",
          productName: order.orderItems?.[0]?.name || "Products",
          quantity: order.orderItems?.reduce((sum, item) => sum + (item.quantity || 1), 0) || 1,
        };
      }
    }
    
    if (!nextDelivery) {
      return res.json({
        success: true,
        data: null,
        message: "No deliveries scheduled for this week",
      });
    }
    
    res.json({
      success: true,
      data: nextDelivery,
    });
  } catch (error) {
    console.error("Error fetching this week's deliveries:", error);
    res.status(500).json({
      success: false,
      message: "Failed to fetch this week's deliveries",
      error: error.message,
    });
  }
});

/**
 * Get delivery history for a user
 * GET /api/delivery-history/:userId
 * Returns all delivered/completed orders and past subscription deliveries
 */
app.get("/api/delivery-history/:userId", (req, res) => {
  try {
    const { userId } = req.params;

    // Generate sample orders for user if they don't have any
    generateSampleOrdersForUser(userId);

    // Get all orders for this user
    const userOrders = Array.from(orders.values()).filter(
      (order) => order.userId === userId
    );

    // Filter to only delivered/completed orders
    const deliveredOrders = userOrders.filter(
      (order) => 
        order.status === "delivered" || 
        order.status === "completed"
    );

    // Generate sample delivery history entries (past subscription deliveries)
    const now = new Date();
    const deliveryHistory = [
      {
        id: `DEL-${userId.slice(-6)}-001`,
        type: "subscription",
        subscriptionId: `SUB-${userId.slice(-6)}`,
        productName: "Bottled Water 19L",
        quantity: 2,
        deliveryDate: new Date(now.getTime() - 14 * 24 * 60 * 60 * 1000).toISOString(), // 14 days ago
        deliveryAddress: "Villa 45, Al Khalidiyah, Abu Dhabi",
        contactNumber: "+971 50 123 4567",
        status: "delivered",
      },
      {
        id: `DEL-${userId.slice(-6)}-002`,
        type: "subscription",
        subscriptionId: `SUB-${userId.slice(-6)}`,
        productName: "Bottled Water 19L",
        quantity: 2,
        deliveryDate: new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000).toISOString(), // 7 days ago
        deliveryAddress: "Villa 45, Al Khalidiyah, Abu Dhabi",
        contactNumber: "+971 50 123 4567",
        status: "delivered",
      },
    ];

    // Convert delivered orders to delivery history format
    const orderHistory = deliveredOrders.map((order) => ({
      id: order.orderId,
      type: "order",
      orderId: order.orderId,
      orderItems: order.orderItems,
      totalAmount: order.totalAmount,
      paymentMethod: order.paymentMethod,
      deliveryDate: order.createdAt, // Use order creation date as delivery date
      deliveryAddress: order.shippingDetails?.address || "Delivery Address",
      contactNumber: order.shippingDetails?.contact || "+971 50 123 4567",
      status: order.status,
    }));

    // Combine and sort by delivery date (newest first)
    const allHistory = [...deliveryHistory, ...orderHistory].sort(
      (a, b) => new Date(b.deliveryDate).getTime() - new Date(a.deliveryDate).getTime()
    );

    res.json({
      success: true,
      data: {
        deliveries: allHistory,
      },
    });
  } catch (error) {
    console.error("Error fetching delivery history:", error);
    res.status(500).json({
      success: false,
      message: "Failed to fetch delivery history",
      error: error.message,
    });
  }
});

/**
 * Create cash on delivery order
 * POST /api/orders/cash-on-delivery
 */
app.post("/api/orders/cash-on-delivery", async (req, res) => {
  try {
    const { userId, orderItems, totalAmount, shippingDetails } = req.body;

    if (!userId || !orderItems || !totalAmount) {
      return res.status(400).json({
        success: false,
        message: "Missing required fields",
      });
    }

    // Create order
    const orderId = `ORD-${Date.now()}`;
    const order = {
      orderId,
      userId,
      orderItems,
      totalAmount,
      shippingDetails: shippingDetails || {},
      paymentMethod: "cash_on_delivery",
      status: "confirmed",
      createdAt: new Date().toISOString(),
      deliveryDate: new Date(Date.now() + 2 * 24 * 60 * 60 * 1000).toISOString(), // 2 days from now
    };

    orders.set(orderId, order);

    res.json({
      success: true,
      data: {
        orderId,
        message: "Order confirmed. Payment will be collected on delivery.",
      },
    });
  } catch (error) {
    console.error("Error creating cash on delivery order:", error);
    res.status(500).json({
      success: false,
      message: "Failed to create order",
      error: error.message,
    });
  }
});

/**
 * Pay with wallet
 * POST /api/orders/pay-with-wallet
 */
/**
 * Authentication Endpoints
 */

// Sign In Initiate - Send phone number, get temporary token
app.post("/api/auth/sign-in-initiate", (req, res) => {
  try {
    const { phone, name } = req.body;

    if (!phone || !name) {
      return res.status(400).json({
        success: false,
        error: "Phone number and name are required",
      });
    }

    // Accept any phone number - find or create user
    let user = Array.from(users.values()).find((u) => u.phone === phone);
    
    // If user doesn't exist, create one
    if (!user) {
      const userId = generateUserId();
      user = {
        userId,
        name: name,
        phone: phone,
      };
      users.set(userId, user);
    }

    // Generate temporary token (OTP validation is bypassed, so we don't need to store OTP)
    const temporaryToken = generateTemporaryToken();
    const expiresAt = Date.now() + 10 * 60 * 1000; // 10 minutes

    // Store temporary token (no OTP validation needed)
    temporaryTokens.set(temporaryToken, {
      phone,
      name: user.name,
      expiresAt,
      isSignUp: false,
      userId: user.userId,
    });

    // Print to terminal (for development)
    console.log("\n🔐 Sign in initiated:");
    console.log(`📱 Phone: ${phone}`);
    console.log(`👤 Name: ${user.name}`);
    console.log(`✅ Any 6-digit OTP will be accepted\n`);

    res.json({
      success: true,
      temporary_token: temporaryToken,
      phone: phone,
      name: user.name,
    });
  } catch (error) {
    console.error("Sign in initiate error:", error);
    res.status(500).json({
      success: false,
      error: "Internal server error",
    });
  }
});

// Sign Up Initiate - Send phone number and name, get temporary token
app.post("/api/auth/sign-up-initiate", (req, res) => {
  try {
    const { phone, name } = req.body;

    if (!phone || !name) {
      return res.status(400).json({
        success: false,
        error: "Phone number and name are required",
      });
    }

    // Check if user already exists
    const existingUser = Array.from(users.values()).find((u) => u.phone === phone);
    
    if (existingUser) {
      return res.status(409).json({
        success: false,
        error: "User already exists. Please sign in instead.",
      });
    }

    // Generate OTP
    const otp = generateOTP();
    const temporaryToken = generateTemporaryToken();
    const expiresAt = Date.now() + 10 * 60 * 1000; // 10 minutes

    // Store temporary token and OTP
    temporaryTokens.set(temporaryToken, {
      phone,
      name,
      otp,
      expiresAt,
      isSignUp: true,
    });

    // Also store OTP by phone for verification
    otpStore.set(phone, {
      otp,
      expiresAt,
    });

    // Print OTP to terminal (for development)
    console.log("\n🔐 OTP for sign up:");
    console.log(`📱 Phone: ${phone}`);
    console.log(`👤 Name: ${name}`);
    console.log(`🔢 OTP: ${otp}`);
    console.log(`⏰ Expires in 10 minutes\n`);

    res.json({
      success: true,
      temporary_token: temporaryToken,
      phone: phone,
      name: name,
    });
  } catch (error) {
    console.error("Sign up initiate error:", error);
    res.status(500).json({
      success: false,
      error: "Internal server error",
    });
  }
});

// Verify OTP - Verify OTP and return permanent token
app.post("/api/auth/verify-otp", (req, res) => {
  try {
    const { temporary_token, otp } = req.body;

    if (!temporary_token || !otp) {
      return res.status(400).json({
        success: false,
        error: "Temporary token and OTP are required",
      });
    }

    // Get temporary token data
    const tokenData = temporaryTokens.get(temporary_token);

    if (!tokenData) {
      return res.status(401).json({
        success: false,
        error: "Invalid or expired temporary token",
      });
    }

    // Check if token expired
    if (Date.now() > tokenData.expiresAt) {
      temporaryTokens.delete(temporary_token);
      return res.status(401).json({
        success: false,
        error: "Temporary token expired",
      });
    }

    // Accept any 6-digit OTP (no validation against stored OTP)
    const otpString = String(otp).trim();
    if (!/^\d{6}$/.test(otpString)) {
      return res.status(400).json({
        success: false,
        error: "OTP must be 6 digits",
      });
    }

    let user;

    if (tokenData.isSignUp) {
      // Create new user
      const userId = generateUserId();
      user = {
        userId,
        name: tokenData.name,
        phone: tokenData.phone,
      };
      users.set(userId, user);
    } else {
      // Sign in - get existing user
      user = users.get(tokenData.userId);
      if (!user) {
        return res.status(404).json({
          success: false,
          error: "User not found",
        });
      }
    }

    // Generate permanent token
    const permanentToken = generatePermanentToken();

    // Clean up temporary token
    temporaryTokens.delete(temporary_token);

    res.json({
      success: true,
      token: permanentToken,
      userId: user.userId,
      name: user.name,
      phone: user.phone,
    });
  } catch (error) {
    console.error("Verify OTP error:", error);
    res.status(500).json({
      success: false,
      error: "Internal server error",
    });
  }
});

app.post("/api/orders/pay-with-wallet", async (req, res) => {
  try {
    const { userId, amount, orderItems, shippingDetails } = req.body;

    if (!userId || !amount || amount <= 0) {
      return res.status(400).json({
        success: false,
        message: "Missing required fields or invalid amount",
      });
    }

    const wallet = getOrCreateWallet(userId);

    // Check if wallet has sufficient balance
    if (wallet.balance < amount) {
      return res.status(400).json({
        success: false,
        message: "Insufficient wallet balance",
        data: {
          balance: wallet.balance,
          required: amount,
          shortfall: amount - wallet.balance,
        },
      });
    }

    // Deduct from wallet
    wallet.balance -= amount;
    wallet.transactions.push({
      id: `TXN-${Date.now()}`,
      type: "purchase",
      amount: -amount,
      timestamp: new Date().toISOString(),
      status: "completed",
    });

    // Create order
    const orderId = `ORD-${Date.now()}`;
    const order = {
      orderId,
      userId,
      orderItems: orderItems || [],
      totalAmount: amount,
      shippingDetails: shippingDetails || {},
      paymentMethod: "wallet",
      status: "confirmed",
      createdAt: new Date().toISOString(),
      deliveryDate: new Date(Date.now() + 2 * 24 * 60 * 60 * 1000).toISOString(), // 2 days from now
    };

    orders.set(orderId, order);

    res.json({
      success: true,
      data: {
        orderId,
        balance: wallet.balance,
        message: "Order confirmed. Payment deducted from wallet.",
      },
    });
  } catch (error) {
    console.error("Error processing wallet payment:", error);
    res.status(500).json({
      success: false,
      message: "Failed to process wallet payment",
      error: error.message,
    });
  }
});

// Start server
// Get network IP address (skip virtual adapters like VirtualBox, VMware, Hyper-V)
const getNetworkIP = () => {
  const interfaces = os.networkInterfaces();
  const virtualAdapterNames = ["virtualbox", "vmware", "hyper-v", "vboxnet", "vmnet", "docker", "wsl", "virtual"];
  const virtualIPRanges = ["192.168.56.", "172.16.", "172.17.", "172.18."]; // Common virtual adapter ranges
  
  // Helper to check if IP is from a virtual adapter
  const isVirtualIP = (ip) => {
    return virtualIPRanges.some(range => ip.startsWith(range));
  };
  
  // First pass: prefer real network adapters (skip virtual by name AND IP)
  for (const name of Object.keys(interfaces)) {
    const nameLower = name.toLowerCase();
    const isVirtualAdapter = virtualAdapterNames.some(virtualName => 
      nameLower.includes(virtualName)
    );
    
    if (isVirtualAdapter) continue; // Skip virtual adapters by name
    
    for (const iface of interfaces[name]) {
      if (iface.family === "IPv4" && !iface.internal) {
        // Skip if it's a known virtual IP range
        if (!isVirtualIP(iface.address)) {
          return iface.address;
        }
      }
    }
  }
  
  // Second pass: use any non-virtual adapter (skip by name only)
  for (const name of Object.keys(interfaces)) {
    const nameLower = name.toLowerCase();
    const isVirtualAdapter = virtualAdapterNames.some(virtualName => 
      nameLower.includes(virtualName)
    );
    
    if (isVirtualAdapter) continue;
    
    for (const iface of interfaces[name]) {
      if (iface.family === "IPv4" && !iface.internal) {
        return iface.address;
      }
    }
  }
  
  // Third pass: fallback to any non-internal IPv4 (last resort)
  for (const name of Object.keys(interfaces)) {
    for (const iface of interfaces[name]) {
      if (iface.family === "IPv4" && !iface.internal) {
        return iface.address;
      }
    }
  }
  
  return "localhost";
};

const networkIP = getNetworkIP();

app.listen(PORT, "0.0.0.0", () => {
  console.log(`🚀 Server running on:`);
  console.log(`   Local:   http://localhost:${PORT}`);
  console.log(`   Network: http://${networkIP}:${PORT}`);
  console.log(`📝 Health check: http://localhost:${PORT}/health`);
});

module.exports = app;
