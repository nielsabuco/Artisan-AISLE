import './firebase-config.js';

const starterProducts = [
    { name: 'Woven Handbag', price: 650, category: 'Bags', image: 'https://i.etsystatic.com/50829130/r/il/396bf3/6117942828/il_1140xN.6117942828_ptjd.jpg' },
    { name: 'Rattan Basket', price: 550, category: 'Woven Items', image: 'https://m.media-amazon.com/images/I/81UngKI1lIL._AC_SL1500_.jpg' },
    { name: 'Traditional Salakot Hat', price: 250, category: 'Accessories', image: 'https://encrypted-tbn0.gstatic.com/images?q=tbn%3AANd9GcTnL8SFXkT9m8bcUeS_KhDu_0hwlkP8oLNKj626tO-oIA&s=10' },
    { name: 'Handmade Lamp', price: 750, category: 'Home Decor', image: 'https://warisanlighting.com/wp-content/uploads/parser/custom-lamps-2.jpg' },
    { name: 'Ceramic Vase', price: 500, category: 'Home Decor', image: 'https://i.etsystatic.com/47070131/r/il/74d632/5569580752/il_fullxfull.5569580752_a2yy.jpg' },
    { name: 'Ceramic Bowl', price: 500, category: 'Home Decor', image: 'https://i.pinimg.com/originals/9b/0a/26/9b0a26ff103f04af01dcf54b7a10c668.jpg' },
    { name: 'Wooden Vase', price: 450, category: 'Home Decor', image: 'https://images.unsplash.com/photo-1610701596007-11502861dcfa?auto=format&fit=crop&w=500&q=80' },
    { name: 'Macrame Wall Hanging', price: 750, category: 'Home Decor', image: 'https://cdn.prod.website-files.com/64006093f522fb0c833dcb75/67ebf8a55fb00b7d266a2b5c_1A2A9119.jpg' }
];

let products = starterProducts;
let activeCategory = 'All Products';
const grid = document.getElementById('productGrid');
const searchInput = document.getElementById('productSearch');
searchInput.value = new URLSearchParams(window.location.search).get('search') || '';

function renderProducts() {
    const query = searchInput.value.trim().toLowerCase();
    const matchingProducts = products.filter(product =>
        (activeCategory === 'All Products' || product.category === activeCategory)
        && `${product.name} ${product.category}`.toLowerCase().includes(query)
    );
    grid.replaceChildren();

    if (matchingProducts.length === 0) {
        const emptyMessage = document.createElement('p');
        emptyMessage.textContent = 'No products match your search.';
        grid.append(emptyMessage);
        return;
    }

    matchingProducts.forEach(product => {
        const card = document.createElement('article');
        card.className = 'product-card';
        card.dataset.category = product.category;

        const image = document.createElement('img');
        image.src = product.image || starterProducts[0].image;
        image.alt = product.name;
        image.loading = 'lazy';

        const info = document.createElement('div');
        info.className = 'product-info';
        const name = document.createElement('h3');
        name.textContent = product.name;
        const price = document.createElement('p');
        price.className = 'price';
        price.textContent = `₱${Number(product.price).toFixed(2)}`;
        const viewButton = document.createElement('button');
        viewButton.className = 'card-btn';
        viewButton.type = 'button';
        viewButton.textContent = 'View Details';
        viewButton.addEventListener('click', () => {
            const params = new URLSearchParams({
                product: product.name,
                price: String(product.price)
            });
            if (product.id) params.set('productId', product.id);
            window.location.href = `index.html?${params.toString()}`;
        });

        info.append(name, price, viewButton);
        card.append(image, info);
        grid.append(card);
    });
}

document.querySelectorAll('[data-category]').forEach(button => {
    button.addEventListener('click', () => {
        activeCategory = button.dataset.category;
        renderProducts();
    });
});
document.getElementById('searchButton').addEventListener('click', renderProducts);
searchInput.addEventListener('input', renderProducts);

window.addEventListener('artisan-products-updated', event => {
    const remoteProducts = event.detail
        .filter(product => !product.deleted && product.status !== 'Out of Stock')
        .map(product => ({
            ...product,
            name: product.name || product.title || 'Unnamed product',
            price: Number(product.price) || 0,
            category: product.category || 'Other',
            image: product.image || product.imageUrl || ''
        }));
    products = [...starterProducts, ...remoteProducts.filter(remote =>
        !starterProducts.some(starter => starter.name.toLowerCase() === remote.name.toLowerCase())
    )];
    renderProducts();
});

renderProducts();
