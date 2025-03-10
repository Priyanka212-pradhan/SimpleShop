

// Import required modules
const express = require("express");
const mysql = require("mysql2/promise");
const session = require("express-session");
const passport = require("passport");
const LocalStrategy = require("passport-local").Strategy;
const bcrypt = require("bcryptjs");
const ejs = require("ejs");
const path = require("path");
const flash = require("connect-flash");
require("dotenv").config();

const app = express();

// Database connection
const db = mysql.createPool({
  host: process.env.DB_HOST || "localhost",
  user: process.env.DB_USER,
  password: process.env.DB_PASS,
  database: process.env.DB_NAME,
  ssl: {
    rejectUnauthorized: false,
  }
});

// Middleware
app.set("view engine", "ejs");
app.set("views", path.join(__dirname, "views"));
app.use(express.urlencoded({ extended: false }));
app.use(express.static("public"));

// Session configuration
app.use(
  session({
    secret: "secret",
    resave: false,
    saveUninitialized: false,
  })
);

// Flash messages middleware
app.use(flash());

// Passport initialization
app.use(passport.initialize());
app.use(passport.session());

// Passport Local Strategy
passport.use(
  new LocalStrategy(async (username, password, done) => {
    try {
      const [rows] = await db.query("SELECT * FROM users WHERE username = ?", [
        username,
      ]);
      if (rows.length === 0) {
        return done(null, false, { message: "Invalid username or password" });
      }
      const user = rows[0];
      const isMatch = await bcrypt.compare(password, user.password);
      if (!isMatch) {
        return done(null, false, { message: "Invalid username or password" });
      }
      return done(null, user);
    } catch (err) {
      return done(err);
    }
  })
);

// Passport serialization and deserialization
passport.serializeUser((user, done) => done(null, user.id));
passport.deserializeUser(async (id, done) => {
  try {
    const [rows] = await db.query("SELECT * FROM users WHERE id = ?", [id]);
    done(null, rows[0]);
  } catch (err) {
    done(err);
  }
});

// Middleware to ensure the user is an admin
function isAdmin(req, res, next) {
  if (!req.user || req.user.role !== "admin") {
    return res.redirect("/"); // Redirect to home if not an admin
  }
  next(); // Proceed if user is admin
}

// Routes
app.get("/", async (req, res) => {
  const userId = req.user?.id || null;;
  let cartedProducts = new Set();
  const errorMessage = req.flash("error");
  const successMessage = req.flash("success");
  const requestUrl = '/';

  try {
    if(userId) {
      // Fetch the user's cart
      const [carts] = await db.query(
          "SELECT products.id FROM carts INNER JOIN products ON carts.product_id = products.id WHERE carts.user_id = ?",
          [userId]
      );

      // Create a set of product IDs that are in the user's cart
       cartedProducts = new Set(carts.map(cart => cart.id));
    }

      // Fetch the available products
      const [products] = await db.query("SELECT * FROM products");

      res.render("home", { user: req.user, products, cartedProducts, errorMessage, successMessage, requestUrl });
  } catch (err) {
      console.error("Error fetching carts:", err);
      res.status(500).send("Internal Server Error.");
  }
});


app.get("/menu", async (req, res) => {
  const [products] = await db.query("SELECT * FROM products");
  res.render("menu", { user: req.user, products });
});

app.get("/login", (req, res) => {
  const errorMessage = req.flash("error");
  const successMessage = req.flash("success");
  res.render("login", { errorMessage, successMessage });
});

app.post("/login", (req, res, next) => {
  passport.authenticate("local", (err, user, info) => {
    if (err) {
      return next(err); // Handle errors
    }
    if (!user) {
      // Authentication failed
      req.flash("error", info.message); // Set flash message
      return res.redirect("/login");
    }
    // Authentication succeeded
    req.logIn(user, (err) => {
      if (err) {
        return next(err);
      }
      // Redirect based on user role
      if (user.role === "admin") {
        return res.redirect("/admin");
      } else {
        return res.redirect("/");
      }
    });
  })(req, res, next);
});

app.get("/logout", (req, res) => {
  req.logout((err) => {
    if (err) return next(err);
    res.redirect("/");
  });
});

app.get("/register", (req, res) => {
  const errorMessage = req.flash("error");
  res.render("register", { errorMessage });
});

app.post("/register", async (req, res) => {
  try {
    const hashedPassword = await bcrypt.hash(req.body.password, 10);
    await db.query(
      "INSERT INTO users (username, password, role) VALUES (?, ?, ?)",
      [req.body.username, hashedPassword, "user"]
    );

    req.flash("success", "Registration successful! You can now log in.");
    res.redirect("/login"); // Redirect to login with success message
  } catch (err) {
    if (err.code === "ER_DUP_ENTRY") {
      req.flash("error", "Username already exists");
    } else {
      req.flash("error", "An error occurred during registration");
    }
    res.redirect("/register");
  }
});

// Admin page
app.get("/admin", isAdmin, async (req, res) => {
  const [products] = await db.query("SELECT * FROM products");
  res.render("admin", { products, user: req.user });
});

// Admin product page
app.get("/admin/product", isAdmin, (req, res) => {
  res.render("admin-product", {
    errorMessage: req.flash("error"),
    successMessage: req.flash("success"),
    user: req.user,
  });
});

app.post("/admin/product", async (req, res) => {
  try {
    const { productName, productPrice, imageUrl, productDescription } = req.body;

    if (!productName || !productPrice || !imageUrl || !productDescription) {
      req.flash("error", "All fields are required.");
      return res.redirect("/admin/product");
    }
    await db.query(
      "INSERT INTO products (name, price, image_url, description) VALUES (?, ?, ?, ?)",
      [productName, productPrice, imageUrl, productDescription]
    );


    req.flash("success", "Product added successfully!");
    res.redirect("/admin");
  } catch (err) {
    console.log("ERRROR", err);
    req.flash("error", "An error occurred while adding product.");
    res.redirect("/admin/product");
  }
});

// Admin update product page
app.get("/admin/update/:id", isAdmin, async (req, res) => {
  const productId = req.params.id;
  try {
    const [rows] = await db.query("SELECT * FROM products WHERE id = ?", [productId]);

    if (rows.length === 0) {
      req.flash("error", "Product not found.");
      return res.redirect("/admin");
    }

    const product = rows[0];
    res.render("admin-update", {
      product,
      errorMessage: req.flash("error"),
      successMessage: req.flash("success"),
      user: req.user,
    });
  } catch (err) {
    console.log("Error fetching product details:", err);
    req.flash("error", "An error occurred while fetching product details.");
    res.redirect("/admin");
  }
});

// Post route to update product details
app.post("/admin/update/:id", isAdmin, async (req, res) => {
  const productId = req.params.id;
  const { productName, productPrice, imageUrl, productDescription } = req.body;

  if (!productName || !productPrice || !imageUrl || !productDescription) {
    req.flash("error", "All fields are required.");
    return res.redirect(`/admin/update/${productId}`);
  }

  try {
    await db.query(
      "UPDATE products SET name = ?, price = ?, image_url = ?, description = ? WHERE id = ?",
      [productName, productPrice, imageUrl, productDescription, productId]
    );

    req.flash("success", "Product updated successfully!");
    res.redirect("/admin");
  } catch (err) {
    console.log("Error updating product:", err);
    req.flash("error", "An error occurred while updating product.");
    res.redirect(`/admin/update/${productId}`);
  }
});

// Route to handle delete product request
app.post("/admin/delete/:id", isAdmin, async (req, res) => {
  const productId = req.params.id;

  

  try {
    await db.query("DELETE FROM products WHERE id = ?", [productId]);

    req.flash("success", "Product deleted successfully!");
    res.redirect("/admin");
  } catch (err) {
    console.log("Error deleting product:", err);
    req.flash("error", "An error occurred while deleting product.");
    res.redirect("/admin");
  }
});


app.post("/add-to-cart", async (req, res) => {
  const { productId } = req.body;

  if(!req.user) {
    req.flash("error", "You must be logged in to add to cart.");
    return res.redirect("/login");
  }
  
  const userId = req.user.id;  // Assuming the user is logged in

  if (!userId || !productId) {
      return res.status(400).send("Invalid request.");
  }

  try {
      // Check if the user already has this product in their cart
      const [existingcart] = await db.query(
          "SELECT * FROM carts WHERE user_id = ? AND product_id = ?",
          [userId, productId]
      );

      if (existingcart.length === 0) {
          // If the user doesn't have this product in their cart, insert a new record
          await db.query(
              "INSERT INTO carts (user_id, product_id) VALUES (?, ?)",
              [userId, productId]
          );
      }
      req.flash("success", "Added to cart successfully!");
      res.redirect("/");  // Redirect back to the home page
  } catch (err) {
      console.error("Error adding to cart:", err);
      req.flash("error", "Error adding to cart!");
      res.status(500).send("Internal Server Error.");
  }

});

// Route to handle removing a product from the user's cart
app.post("/remove-from-cart", async (req, res) => {
  // Check if the user is logged in
  if (!req.user) {
      // If not logged in, redirect to login page
      return res.redirect("/login");
  }

  const userId = req.user.id;  // Get the user's ID from the session or authentication system
  const productId = req.body.productId;  // Get the product ID from the form submission
  const redirectUrl = req.body.redirectUrl || '/';  // Get the redirect URL from the form, default to homepage

  try {
      // Delete the cart entry for products
      await db.query(
          "DELETE FROM carts WHERE user_id = ? AND product_id = ?",
          [userId, productId]
      );

      // Redirect the user back to the page they were on
      req.flash("success", "Removed from cart successfully!");
      res.redirect(redirectUrl);
  } catch (err) {
      console.error("Error removing from cart:", err);
      req.flash("error", "Error removing from cart!");
      res.status(500).send("Internal Server Error.");
  }
});


// Route to display the user's carts
app.get("/my-cart", async (req, res) => {
  // Check if the user is logged in
  if (!req.user) {
      return res.redirect("/login");  // Redirect to login if not logged in
  }
  const errorMessage = req.flash("error");
  const successMessage = req.flash("success");
  const requestUrl = '/my-cart';

  const userId = req.user.id; // Get the user's ID from the session or authentication system

  try {
      // Fetch the carts for the logged-in user
      const [carts] = await db.query(
          "SELECT carts.id, products.id as product_id, products.name, products.description, products.price, products.image_url FROM carts JOIN products ON carts.product_id = products.id WHERE carts.user_id = ?",
          [userId]
      );

      // Render the "My cart" page with the user's carts
      res.render("my-cart", { user: req.user, carts: carts, errorMessage, successMessage, requestUrl });
  } catch (err) {
      console.error("Error fetching carts:", err);
      res.status(500).send("Internal Server Error.");
  }
});






// Start the server
app.listen(3000, () => console.log("Server running on port 3000"));
