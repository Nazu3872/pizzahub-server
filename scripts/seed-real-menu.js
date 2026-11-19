const { connectDB, getDB } = require('../src/db/connection');

const realPizzas = [
  {
    itemName: 'Margherita Napoletana',
    category: 'Classic Pizzas',
    description: 'San Marzano DOP tomato coulis, fresh buffalo mozzarella, aromatic sweet basil leaves, and cold-pressed extra virgin olive oil.',
    price: 15.5,
    location: 'Gulshan-2, Dhaka',
    images: [
      'https://images.unsplash.com/photo-1604382354936-07c5d9983bd3?auto=format&fit=crop&w=800&q=80',
      'https://images.unsplash.com/photo-1574071318508-1cdbab80d002?auto=format&fit=crop&w=800&q=80',
    ],
    status: 'approved',
    vendorId: '6afeba851c4083c4535d4d60',
    vendorName: 'Napoli Fire Kitchen',
    createdAt: new Date(),
    updatedAt: new Date(),
  },
  {
    itemName: 'Spicy Pepperoni & Hot Honey',
    category: 'Meat Lovers',
    description: 'Crispy cupped beef pepperoni, aged Wisconsin mozzarella, fiery Calabrian chili flakes, and hot habanero honey drizzle.',
    price: 18.0,
    location: 'Gulshan-2, Dhaka',
    images: [
      'https://images.unsplash.com/photo-1628840042765-356cda07504e?auto=format&fit=crop&w=800&q=80',
    ],
    status: 'approved',
    vendorId: '6afeba851c4083c4535d4d60',
    vendorName: 'Napoli Fire Kitchen',
    createdAt: new Date(),
    updatedAt: new Date(),
  },
  {
    itemName: 'Truffle Mushroom Bianco',
    category: 'Specialty / Gourmet Pizzas',
    description: 'Roasted wild cremini & shiitake mushrooms, creamy fontina, fresh thyme, and white truffle infused virgin olive oil.',
    price: 21.0,
    location: 'Banani, Dhaka',
    images: [
      'https://images.unsplash.com/photo-1513104890138-7c749659a591?auto=format&fit=crop&w=800&q=80',
    ],
    status: 'approved',
    vendorId: '6afeba851c4083c4535d4d77',
    vendorName: 'Milano Crust Co',
    createdAt: new Date(),
    updatedAt: new Date(),
  },
  {
    itemName: 'Mediterranean Garden Primavera',
    category: 'Vegetarian Pizzas',
    description: 'Baby spinach, kalamata olives, sun-dried tomatoes, roasted red peppers, artichoke hearts, and crumbled sheep feta.',
    price: 17.0,
    location: 'Dhanmondi, Dhaka',
    images: [
      'https://images.unsplash.com/photo-1565299624946-b28f40a0ae38?auto=format&fit=crop&w=800&q=80',
    ],
    status: 'approved',
    vendorId: '6afeba851c4083c4535d4d77',
    vendorName: 'Milano Crust Co',
    createdAt: new Date(),
    updatedAt: new Date(),
  },
  {
    itemName: 'Smoked BBQ Chicken & Crisp Bacon',
    category: 'Meat Lovers',
    description: 'Hickory-smoked chicken breast, applewood bacon crumbles, red onions, smoked provolone, and chipotle barbecue drizzle.',
    price: 19.5,
    location: 'Gulshan-1, Dhaka',
    images: [
      'https://images.unsplash.com/photo-1593560708920-61dd98c46a4e?auto=format&fit=crop&w=800&q=80',
    ],
    status: 'approved',
    vendorId: '6afeba851c4083c4535d4d60',
    vendorName: 'Napoli Fire Kitchen',
    createdAt: new Date(),
    updatedAt: new Date(),
  },
  {
    itemName: 'Golden Garlic Knots with Warm Marinara',
    category: 'Sides & Appetizers',
    description: 'Hand-tied organic pizza dough tossed in roasted garlic butter, grated Pecorino Romano, and Italian parsley. Served with slow-cooked marinara.',
    price: 7.5,
    location: 'Gulshan-2, Dhaka',
    images: [
      'https://images.unsplash.com/photo-1541745537411-b8046dc6d66c?auto=format&fit=crop&w=800&q=80',
    ],
    status: 'approved',
    vendorId: '6afeba851c4083c4535d4d60',
    vendorName: 'Napoli Fire Kitchen',
    createdAt: new Date(),
    updatedAt: new Date(),
  },
  {
    itemName: 'Classic Espresso Tiramisu',
    category: 'Beverages & Desserts',
    description: 'Italian ladyfingers soaked in dark roasted espresso and amaretto, layered with velvety mascarpone cream and dusted with Valrhona cocoa.',
    price: 8.5,
    location: 'Gulshan-2, Dhaka',
    images: [
      'https://images.unsplash.com/photo-1571877227200-a0d98ea607e9?auto=format&fit=crop&w=800&q=80',
    ],
    status: 'approved',
    vendorId: '6afeba851c4083c4535d4d60',
    vendorName: 'Napoli Fire Kitchen',
    createdAt: new Date(),
    updatedAt: new Date(),
  },
];

async function seed() {
  await connectDB();
  const db = getDB();
  const menuItems = db.collection('menuItems');

  for (const pizza of realPizzas) {
    await menuItems.updateOne(
      { itemName: pizza.itemName },
      { $set: pizza },
      { upsert: true }
    );
  }

  const count = await menuItems.countDocuments({ status: 'approved' });
  console.log(`Successfully seeded real menu. Total approved items in DB: ${count}`);
  process.exit(0);
}

seed().catch((e) => {
  console.error(e);
  process.exit(1);
});
