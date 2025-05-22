# Vehicle Image Analysis & Web Scraping API

Bu proje, araç görüntü analizi ve web scraping özelliklerini birleştiren güçlü bir REST API sunar. GPT-4 Vision modeli kullanarak araç görüntülerini analiz eder ve Playwright ile gelişmiş web scraping özellikleri sağlar.

## Özellikler

### Araç Görüntü Analizi
- 🚗 Araç açılarını otomatik tespit (ön, arka, sol, sağ, iç mekan vb.)
- 🔍 Detaylı araç durumu ve hasar analizi
- 🎯 Yüksek doğruluk oranı ile hasar şiddeti tespiti
- 📊 Güven skoru ile analiz sonuçları

### Web Scraping
- 🌐 Gelişmiş web scraping özellikleri
- 🔄 Akıllı önbellek sistemi
- 🛡️ Reklam ve izleme engelleme
- 📊 Kapsamlı veri çıkarma seçenekleri
- 🧩 Çoklu seçici desteği
- 📡 Yapılandırılabilir zaman aşımı süreleri

## Kurulum

1. Projeyi klonlayın:
```bash
git clone [repo-url]
cd [proje-dizini]
```

2. Bağımlılıkları yükleyin:
```bash
npm install
```

3. Playwright tarayıcılarını yükleyin:
```bash
npx playwright install chromium
```

4. `.env` dosyasını oluşturun ve aşağıdaki değişkenleri ayarlayın:
```env
PORT=3000
OPENAI_API_KEY=your_openai_api_key

# Opsiyonel - OpenAI ayarları (varsayılan değerler kullanılır)
# OPENAI_API_MODEL=gpt-4.1
# OPENAI_MAX_TOKENS=2048
# OPENAI_API_URL=https://api.openai.com/v1/chat/completions

# Opsiyonel - CORS ayarları (production için)
# NODE_ENV=production
# ALLOWED_ORIGINS=https://your-frontend-domain.com,https://another-domain.com
```

5. Uygulamayı başlatın:
```bash
# Geliştirme modu
npm run dev

# Üretim modu
npm start
```

## API Endpoint'leri

### Araç Görüntü Analizi

#### Tekli Görüntü Analizi
```http
POST /api/analyze
Content-Type: application/json

{
    "imageUrl": "https://example.com/vehicle-image.jpg"
}
```

#### Hasar Analizi
```http
POST /api/damage-analyze
Content-Type: application/json

{
    "imageUrl": "https://example.com/damaged-vehicle.jpg"
}
```

### Web Scraping

#### Veri Çıkarma
```http
POST /api/scraper/scrape
Content-Type: application/json

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
        "blockAds": true
    }
}
```

#### Önbellek Temizleme
```http
DELETE /api/scraper/cache
```

#### API Durumu
```http
GET /api/scraper/status
```

### Araç Görüntü Kırpma ve Analiz (Cropper)

Bu endpoint, yüklenen bir görüntünün belirli alanlarını kırpar ve her bir kırpılmış alanı OpenAI Vision API kullanarak analiz eder.

#### Görüntü Kırpma ve Analiz
```http
POST /api/cropper/crop-analyze
Content-Type: multipart/form-data

Form Alanları:
- image: (dosya) Yüklenecek görüntü dosyası (JPEG veya PNG, maks 5MB).
```

**Yanıt Örneği:**
```json
{
    "message": "Analiz tamamlandı",
    "detectedAreas": [
        {
            "label": "sürücü görüşleri",
            "box": { "x": 50, "y": 1150, "width": 10000, "height": 2500 },
            "cropFile": "1678886400000_0_sürücü_görüşleri.jpg",
            "detail": { /* OpenAI analiz sonucu veya hata */ }
        },
        {
            "label": "çarpışma yerinin ve anının taslağını çiziniz",
            "box": { "x": 29, "y": 1000, "width": 900, "height": 190 },
            "cropFile": "1678886400001_1_çarpışma_yerinin_ve_anının_taslağını_çiziniz.jpg",
            "detail": { /* OpenAI analiz sonucu veya hata */ }
        }
    ]
}
```

## Seçici Tipleri

- `