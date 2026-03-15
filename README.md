# n11.com Product Scraper

This scraper extracts product data from n11.com category and product detail pages. It uses [Crawlee](https://crawlee.dev/) and Playwright for efficient data extraction.

## Features

- **Category Scraping**: Automatically identifies and enqueues products from category pages.
- **Efficient Extraction**: Extracts detailed product data from server-side rendered JSON (`window.productModel`) for speed and accuracy.
- **Pagination**: Supports automatic pagination through category results.
- **Data Extracted**:
    - Product ID
    - Title
    - Brand
    - Price (including "SEPETTE" final price)
    - Seller Information
    - Category
    - In-stock Status
    - Thumbnail Image

## How to Run Locally

1. Install dependencies:
   ```bash
   npm install
   ```

2. Build the project:
   ```bash
   npm run build
   ```

3. Run the scraper:
   ```bash
   npm start
   ```

## Development

The scraper logic is located in `src/routes.ts`, and the main entry point is `src/main.ts`.
JSON extraction is prioritized as it is much faster and less prone to UI shifts than standard HTML parsing.
