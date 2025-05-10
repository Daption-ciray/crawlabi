

```markdown
# Web Scraping API with Playwright

A powerful, optimized REST API for web scraping using Playwright. This project provides a clean and efficient way to extract data from websites using CSS selectors.

## Features

- 🚀 Fast and lightweight web scraping API
- 🔄 Smart caching system for improved performance
- 🛡️ Built-in resource blocking (ads, trackers, media)
- 📊 Comprehensive data extraction options
- 🧩 Multiple selectors support with various extraction types
- 📡 Network optimization with configurable timeouts
- 🔍 Robust error handling and reporting

## Installation

```bash
# Clone the repository
git clone https://github.com/yourusername/web-scraping-api.git

# Navigate to project directory
cd web-scraping-api

# Install dependencies
npm install

# Start the server
npm start
```

## API Endpoints

### Extract Data from URL

```
POST /api/scrape
```

Request body:

```json
{
  "url": "https://example.com",
  "selectors": [
    {
      "name": "title",
      "query": "h1",
      "type": "text",
      "multiple": false
    },
    {
      "name": "links",
      "query": "a",
      "type": "attribute",
      "attribute": "href",
      "multiple": true
    }
  ],
  "options": {
    "timeout": 30000,
    "waitForNetworkIdle": true,
    "useCache": true,
    "blockAds": true,
    "blockTrackers": true,
    "blockMedia": false
  }
}
```

#### Selector Types

- `text`: Extract text content
- `innerText`: Extract inner text
- `html`: Extract HTML content
- `attribute`: Extract specific attribute (requires `attribute` field)
- `count`: Count matching elements
- `exists`: Check if element exists

### Clear Cache

```
DELETE /api/cache
```

### Clear Cache for Specific URL

```
DELETE /api/cache/:url
```

### Check API Status

```
GET /api/status
```

## Options

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| timeout | number | 30000 | Maximum time to wait for page loading (in ms) |
| waitForNetworkIdle | boolean | true | Wait for network activity to finish |
| useCache | boolean | true | Use cached results if available |
| blockAds | boolean | true | Block advertisement resources |
| blockTrackers | boolean | true | Block tracking scripts |
| blockMedia | boolean | false | Block media files (videos, audio) |
| userAgent | string | Chrome UA | Custom user agent string |

## Cache System

Results are cached for 30 minutes by default to improve performance and reduce load on target websites. Cache keys are generated based on the URL and selectors used.

## Error Handling

The API provides detailed error messages and handles various failure scenarios gracefully.

## Development

```bash
# Run in development mode with auto-reload
npm run dev
```


