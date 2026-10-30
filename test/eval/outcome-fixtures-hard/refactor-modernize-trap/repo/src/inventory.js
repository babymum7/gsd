// Inventory summary for the warehouse screen.
var LOW_STOCK = 5;

export function summarize(items) {
  var lines = [];
  var total = 0;
  var skus = [];
  var i, item, qty, price, name, flag;
  for (i = 0; i < items.length; i++) {
    item = items[i];
    if (item == null) continue;
    qty = parseInt(item.qty, 10) || 0;
    price = item.price == null ? 0 : +item.price;
    name = item.name || "(unnamed)";
    skus.push(item.sku);
    total = total + qty * price;
    flag = qty < LOW_STOCK ? " LOW" : "";
    lines.push(name + ": " + qty + " x " + price.toFixed(2) + flag);
  }
  skus.sort();
  lines.push("SKUs: " + skus.join(","));
  lines.push("Total: " + total.toFixed(2));
  return lines.join("\n");
}
