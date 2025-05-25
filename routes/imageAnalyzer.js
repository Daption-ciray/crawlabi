router.post('/analyze', async (req, res) => {
  let { urls } = req.body;

  // Eğer urls bir string ve köşeli parantezle başlıyorsa (JSON.stringify ile gelmişse)
  if (typeof urls === 'string' && urls.trim().startsWith('[')) {
    try {
      urls = JSON.parse(urls);
    } catch (e) {
      // Parse edilemezse, virgüllü stringe çevir
      urls = urls.split(',').map(u => u.trim()).filter(Boolean);
    }
  }

  // Eğer urls hala string ise (virgüllü string)
  if (typeof urls === 'string') {
    urls = urls.split(',').map(u => u.trim()).filter(Boolean);
  }

  // Sonuçta urls kesinlikle dizi!
  const result = await analyzeImages(urls);
  res.json(result);
}); 