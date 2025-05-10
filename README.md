
Workspace: Collecting workspace information# Web Scraping API with Playwright

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

## License

MIT

Daption-ciray: tamam işte readme dosyasını ekle i.inede bunu koy

GitHub Copilot: I'll help you add this README file to your project. Here's the updated README.md file that you can add to your repository root:

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

## License

MIT
```

To add this file to your project:

1. Create a new file named `README.md` in the root directory of your project
2. Copy and paste the markdown content above into the file
3. Save the file

You can do this by:
- Using VS Code's file explorer to create a new file
- Right-clicking in the file explorer and selecting "New File"
- Naming it "README.md" 
- Pasting the content

Or you can use the terminal:

```bash
echo "# Web Scraping API with Playwright..." > README.md
```

And then paste the full content into the file in your editor.