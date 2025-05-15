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

4. `.env` dosyasını oluşturun:
```env
PORT=3000
OPENAI_API_KEY=your_openai_api_key
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

## Seçici Tipleri

- `text`: Metin içeriği çıkarma
- `innerText`: İç metin çıkarma
- `html`: HTML içeriği çıkarma
- `attribute`: Belirli bir öznitelik çıkarma (attribute alanı gerekli)
- `count`: Eşleşen öğeleri sayma
- `exists`: Öğenin varlığını kontrol etme

## Önbellek Sistemi

Sonuçlar varsayılan olarak 30 dakika süreyle önbelleğe alınır. Bu süre, performansı artırmak ve hedef web sitelerindeki yükü azaltmak için kullanılır. Önbellek anahtarları URL ve kullanılan seçicilere göre oluşturulur.

## Hata Yönetimi

API, detaylı hata mesajları sağlar ve çeşitli hata senaryolarını zarif bir şekilde yönetir.

## Geliştirme

```bash
# Geliştirme modunda çalıştırma (otomatik yeniden başlatma)
npm run dev

# Scraping testi
npm run scrape
```

## Lisans

MIT

## İletişim

[İletişim bilgileriniz] 