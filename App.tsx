import AsyncStorage from '@react-native-async-storage/async-storage';
import { LinearGradient } from 'expo-linear-gradient';
import * as Sharing from 'expo-sharing';
import { useMemo, useState, useEffect, useCallback } from 'react';
import {
  Alert,
  ActivityIndicator,
  Image,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';

const GEMINI_KEY = 'AIzaSyCmSOcXtyc5Y06L-b9YyDzAUOsc8G6rlAo';
const GUNLUK_KEY = 'ruya_gunlugu';

const duyguRenk = {
  huzurlu: '#4ade80',
  kaygili: '#fb923c',
  heyecanli: '#60a5fa',
  karisik: '#c084fc',
  korkutucu: '#f87171',
} as const;

const duyguEmoji = {
  huzurlu: '🌿',
  kaygili: '😰',
  heyecanli: '⚡',
  karisik: '🌀',
  korkutucu: '👁',
} as const;

type DuyguTipi = keyof typeof duyguRenk;
type SembolTipi = { isim: string; anlam: string };
type AnalizTipi = { yorum: string; semboller: SembolTipi[]; duygu: DuyguTipi; ozet: string };
type GorselDurumu = { acik: boolean; yukleniyor: boolean; prompt: string; imageUrl: string | null; hata: string | null };
type GunlukKayit = { id: string; ruya: string; analiz: AnalizTipi; tarih: string; imageUrl?: string };

const defaultGorsel: GorselDurumu = { acik: false, yukleniyor: false, prompt: '', imageUrl: null, hata: null };

function temizleKodBloklari(text: string): string {
  return text.replace(/```json|```/g, '').trim();
}

function duyguGecerliMi(value: unknown): value is DuyguTipi {
  return typeof value === 'string' && value in duyguRenk;
}

function guvenliAnalizParse(text: string): AnalizTipi {
  const clean = temizleKodBloklari(text);
  try {
    const parsed = JSON.parse(clean) as any;
    const semboller: SembolTipi[] = Array.isArray(parsed.semboller)
      ? parsed.semboller.filter(
          (item: unknown): item is SembolTipi =>
            typeof item === 'object' && item !== null &&
            typeof (item as SembolTipi).isim === 'string' &&
            typeof (item as SembolTipi).anlam === 'string'
        )
      : [];
    return {
      yorum: typeof parsed.yorum === 'string' ? parsed.yorum : clean,
      semboller,
      duygu: duyguGecerliMi(parsed.duygu) ? parsed.duygu : 'karisik',
      ozet: typeof parsed.ozet === 'string' && parsed.ozet.trim().length > 0 ? parsed.ozet : 'Özet oluşturulamadı.',
    };
  } catch {
    return { yorum: clean || 'Yorum üretilemedi.', semboller: [], duygu: 'karisik', ozet: 'Yanıt işlenemedi.' };
  }
}

function gorselPromptOlustur(analiz: AnalizTipi): string {
  const sembolSatiri = analiz.semboller.length
    ? analiz.semboller.map((s) => s.isim).join(', ')
    : 'soyut rüya sembolleri';
  return `Create a dreamlike cinematic illustration inspired by this dream: "${analiz.ozet}". Mood: ${analiz.duygu}. Symbols: ${sembolSatiri}. Surreal, mystical, soft moonlight, high detail, no text.`;
}

function tarihleriFormatla(isoString: string): string {
  const tarih = new Date(isoString);
  return tarih.toLocaleDateString('tr-TR', { day: 'numeric', month: 'long', year: 'numeric' });
} 

type Ekran = 'onboarding' | 'ana' | 'yorum' | 'gunluk' | 'detay' | 'istatistik';

export default function App() {
  const [ekran, setEkran] = useState<Ekran>('onboarding');
  const [ruya, setRuya] = useState('');
  const [yukleniyor, setYukleniyor] = useState(false);
  const [analiz, setAnaliz] = useState<AnalizTipi | null>(null);
  const [gorsel, setGorsel] = useState<GorselDurumu>(defaultGorsel);
  const [gunluk, setGunluk] = useState<GunlukKayit[]>([]);
  const [seciliKayit, setSeciliKayit] = useState<GunlukKayit | null>(null);
  const [aktifSlide, setAktifSlide] = useState(0);
  
  useEffect(() => { gunluguYukle(); }, []);

  useEffect(() => { onboardingKontrol();}, []);

  const onboardingKontrol = async () => {
  const goruldu = await AsyncStorage.getItem('onboarding_goruldu');
  if (goruldu) setEkran('ana');
  else setEkran('onboarding');
  };

  const gunluguYukle = async () => {
    try {
      const json = await AsyncStorage.getItem(GUNLUK_KEY);
      if (json) setGunluk(JSON.parse(json));
    } catch (e) { console.error('Günlük yüklenemedi:', e); }
  };

  const gunluguKaydet = async (yeniKayitlar: GunlukKayit[]) => {
    try {
      await AsyncStorage.setItem(GUNLUK_KEY, JSON.stringify(yeniKayitlar));
    } catch (e) { console.error('Günlük kaydedilemedi:', e); }
  };

  const kayitEkle = useCallback(async (analizVeri: AnalizTipi, ruyaMetni: string) => {
    const yeniKayit: GunlukKayit = {
      id: Date.now().toString(),
      ruya: ruyaMetni,
      analiz: analizVeri,
      tarih: new Date().toISOString(),
    };
    const yeniGunluk = [yeniKayit, ...gunluk];
    setGunluk(yeniGunluk);
    await gunluguKaydet(yeniGunluk);
  }, [gunluk]);

  const kayitSil = async (id: string) => {
    Alert.alert('Sil', 'Bu rüyayı silmek istiyor musun?', [
      { text: 'İptal', style: 'cancel' },
      { text: 'Sil', style: 'destructive', onPress: async () => {
        const yeniGunluk = gunluk.filter(k => k.id !== id);
        setGunluk(yeniGunluk);
        await gunluguKaydet(yeniGunluk);
        setEkran('gunluk');
      }},
    ]);
  };

  const analizPrompt = useMemo(() => `Sen deneyimli bir rüya analisti ve psikoloji uzmanısın.
Aşağıdaki rüyayı analiz et ve SADECE şu JSON formatında yanıt ver, başka hiçbir şey yazma:
{
  "yorum": "200 kelimelik derin psikolojik yorum",
  "semboller": [
    {"isim": "sembol adı", "anlam": "sembolün anlamı"},
    {"isim": "sembol adı", "anlam": "sembolün anlamı"}
  ],
  "duygu": "huzurlu veya kaygili veya heyecanli veya karisik veya korkutucu",
  "ozet": "tek cümlelik özet"
}
Rüya: "${ruya}"`, [ruya]);

  const yorumla = async () => {
    if (ruya.trim().length < 20) { Alert.alert('Uyarı', 'Biraz daha detaylı yaz.'); return; }
    setYukleniyor(true);
    setAnaliz(null);
    try {
      const response = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${GEMINI_KEY}`,
        { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ contents: [{ parts: [{ text: analizPrompt }] }] }) }
      );
      const data = await response.json();
      if (!response.ok) throw new Error(data?.error?.message || `HTTP ${response.status}`);
      const text = data?.candidates?.[0]?.content?.parts?.[0]?.text;
      if (!text) throw new Error('Modelden geçerli analiz dönmedi.');
      const parsed = guvenliAnalizParse(text);
      setAnaliz(parsed);
      setEkran('yorum');
      await kayitEkle(parsed, ruya);
    } catch (error: unknown) {
      Alert.alert('Hata', error instanceof Error ? error.message : 'Yorum alınamadı.');
    } finally {
      setYukleniyor(false);
    }
  };

  const gorselOlustur = async () => {
    if (!analiz) return;
    const prompt = gorselPromptOlustur(analiz);
    setGorsel({ acik: true, yukleniyor: true, prompt, imageUrl: null, hata: null });
    try {
     const res = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-image:generateContent?key=${GEMINI_KEY}`,
        { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({
  contents: [{ parts: [{ text: prompt }] }],
  generationConfig: { responseModalities: ['IMAGE', 'TEXT'] },
})}
      );
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error?.message || `HTTP ${res.status}`);
      const parts = data?.candidates?.[0]?.content?.parts || [];
const imgPart = parts.find((p: any) => p?.inlineData?.data);
if (!imgPart) throw new Error('Görsel verisi gelmedi.');
const imageUrl = `data:image/png;base64,${imgPart.inlineData.data}`;
      setGorsel({ acik: true, yukleniyor: false, prompt, imageUrl, hata: null });
      // Görseli son kayda ekle
      setGunluk(prev => {
        const guncellenmis = prev.map((k, i) => i === 0 ? { ...k, imageUrl } : k);
        gunluguKaydet(guncellenmis);
        return guncellenmis;
      });
    } catch (e: any) {
      setGorsel({ acik: true, yukleniyor: false, prompt, imageUrl: null, hata: e.message });
    }
  };
  const gorselPaylas = async (imageUrl: string) => {
  try {
    // base64'ü dosyaya çevir
    const base64Data = imageUrl.replace('data:image/png;base64,', '');
    const dosyaYolu = `${require('expo-file-system').documentDirectory}morpheus_ruya.png`;
    await require('expo-file-system').writeAsStringAsync(dosyaYolu, base64Data, {
      encoding: require('expo-file-system').EncodingType.Base64,
    });
    await Sharing.shareAsync(dosyaYolu, {
      mimeType: 'image/png',
      dialogTitle: 'Rüyamı Paylaş',
    });
  } catch (e: any) {
    Alert.alert('Hata', 'Paylaşım başarısız: ' + e.message);
  }
   };

  const seciliDuyguRenk = analiz ? duyguRenk[analiz.duygu] : '#6c47ff';

  // ── ANA EKRAN ──
  if (ekran === 'ana') return (
    <View style={{ flex: 1 }}>
      <ScrollView style={styles.container} contentContainerStyle={styles.icerik}>
        <Text style={styles.baslik}>🌙 Rüya Yorumlayıcı</Text>
        <Text style={styles.altyazi}>Bilinçaltının kapısını ara</Text>

        <View style={styles.inputKart}>
          <Text style={styles.inputLabel}>RÜYANI ANLAT</Text>
          <TextInput
            style={styles.input}
            multiline
            placeholder="Bu gece rüyamda..."
            placeholderTextColor="#333"
            value={ruya}
            onChangeText={setRuya}
            maxLength={800}
          />
          <View style={styles.inputAlt}>
            <Text style={styles.ipucu}>{ruya.length < 20 ? `${20 - ruya.length} karakter daha` : '✓ Hazır'}</Text>
            <Text style={styles.sayac}>{ruya.length}/800</Text>
          </View>
        </View>

        <TouchableOpacity
          style={[styles.buton, ruya.trim().length < 20 && styles.butonDevre]}
          onPress={yorumla}
          disabled={yukleniyor || ruya.trim().length < 20}
        >
          {yukleniyor
            ? <View style={styles.yukleniyorSatir}><ActivityIndicator color="#fff" /><Text style={styles.butonYazi}> Analiz ediliyor...</Text></View>
            : <Text style={styles.butonYazi}>✨ Yorumla</Text>
          }
        </TouchableOpacity>

        {gunluk.length > 0 && (
          <>
            <Text style={styles.bolumBaslik}>📖 Son Rüyalar</Text>
            {gunluk.slice(0, 3).map((kayit) => (
              <TouchableOpacity key={kayit.id} style={styles.gunlukKart} onPress={() => { setSeciliKayit(kayit); setEkran('detay'); }}>
                <View style={styles.gunlukKartUst}>
                  <View style={[styles.miniBadge, { backgroundColor: duyguRenk[kayit.analiz.duygu] + '22' }]}>
                    <Text style={{ color: duyguRenk[kayit.analiz.duygu], fontSize: 11, fontWeight: 'bold' }}>
                      {duyguEmoji[kayit.analiz.duygu]} {kayit.analiz.duygu}
                    </Text>
                  </View>
                  <Text style={styles.tarihYazi}>{tarihleriFormatla(kayit.tarih)}</Text>
                </View>
                <Text style={styles.gunlukOzet} numberOfLines={2}>"{kayit.analiz.ozet}"</Text>
              </TouchableOpacity>
            ))}
            {gunluk.length > 0 && (
             <View style={styles.altButonlar}>
             <TouchableOpacity style={styles.gunlukButon} onPress={() => setEkran('gunluk')}>
             <Text style={styles.gunlukButonYazi}>📖 {gunluk.length}</Text>
             </TouchableOpacity>
             <TouchableOpacity style={styles.gunlukButon} onPress={() => setEkran('istatistik')}>
             <Text style={styles.gunlukButonYazi}>📊</Text>
             </TouchableOpacity>
             </View>
            )}
          </>
        )}
        <View style={{ height: 80 }} />
      </ScrollView>

      {gunluk.length > 0 && (
        <TouchableOpacity style={styles.gunlukButon} onPress={() => setEkran('gunluk')}>
          <Text style={styles.gunlukButonYazi}>📖 {gunluk.length}</Text>
        </TouchableOpacity>
      )}
    </View>
  );

  // ── YORUM EKRANI ──
  if (ekran === 'yorum' && analiz) return (
    <View style={{ flex: 1 }}>
      <ScrollView style={styles.container} contentContainerStyle={styles.icerik}>
        <TouchableOpacity onPress={() => setEkran('ana')} style={styles.geriButon}>
          <Text style={styles.geriYazi}>← Geri</Text>
        </TouchableOpacity>
        <View style={[styles.duyguKart, { borderColor: seciliDuyguRenk + '44', backgroundColor: seciliDuyguRenk + '11' }]}>
          <Text style={styles.duyguEmoji}>{duyguEmoji[analiz.duygu]}</Text>
          <Text style={[styles.duyguYazi, { color: seciliDuyguRenk }]}>{analiz.duygu.toUpperCase()}</Text>
        </View>
        <Text style={styles.ozet}>"{analiz.ozet}"</Text>
        <Text style={styles.kaydedildiYazi}>✓ Günlüğüne kaydedildi</Text>
        <Text style={styles.bolumBaslik}>📖 Yorum</Text>
        <View style={styles.bolumKutu}><Text style={styles.yorumYazi}>{analiz.yorum}</Text></View>
        <Text style={styles.bolumBaslik}>🔮 Semboller</Text>
        {analiz.semboller.map((s, i) => (
          <View key={i} style={styles.sembolKart}>
            <View style={styles.sembolNo}><Text style={styles.sembolNoYazi}>{i + 1}</Text></View>
            <View style={{ flex: 1 }}><Text style={styles.sembolIsim}>{s.isim}</Text><Text style={styles.sembolAnlam}>{s.anlam}</Text></View>
          </View>
        ))}
        <TouchableOpacity style={styles.gorselButon} onPress={gorselOlustur}>
          <Text style={styles.gorselButonYazi}>🖼️ Rüyayı Görsele Çevir</Text>
        </TouchableOpacity>
        <TouchableOpacity style={styles.yeniButon} onPress={() => { setRuya(''); setAnaliz(null); setGorsel(defaultGorsel); setEkran('ana'); }}>
          <Text style={styles.yeniButonYazi}>+ Yeni Rüya</Text>
        </TouchableOpacity>
        <View style={{ height: 40 }} />
      </ScrollView>
      {gorsel.acik && (
        <View style={styles.modalOverlay}>
          <View style={styles.modalArka}>
            <View style={styles.modalKart}>
              <Text style={styles.modalBaslik}>🖼️ Rüya Görseli</Text>
              {gorsel.yukleniyor && <View style={styles.modalYukleniyor}><ActivityIndicator size="large" color="#8b5cf6" /><Text style={styles.modalYazi}>Oluşturuluyor...</Text></View>}
              {gorsel.hata && <View style={styles.hataKutu}><Text style={styles.hataYazi}>⚠️ {gorsel.hata}</Text></View>}
              {gorsel.imageUrl && (  <>  
              <Image source={{ uri: gorsel.imageUrl }} style={styles.gorsel} resizeMode="cover" />
              <TouchableOpacity
              style={styles.paylasButon}
              onPress={() => gorselPaylas(gorsel.imageUrl!)}
              >
      <Text style={styles.paylasYazi}>↑ Paylaş</Text>
    </TouchableOpacity>
  </>
)}
              <Pressable style={styles.kapatButon} onPress={() => setGorsel(defaultGorsel)}>
                <Text style={styles.kapatButonYazi}>Kapat</Text>
              </Pressable>
            </View>
          </View>
        </View>
      )}
    </View>
  );

  // ── GÜNLÜK EKRANI ──
  if (ekran === 'gunluk') return (
    <ScrollView style={styles.container} contentContainerStyle={styles.icerik}>
      <TouchableOpacity onPress={() => setEkran('ana')} style={styles.geriButon}>
        <Text style={styles.geriYazi}>← Geri</Text>
      </TouchableOpacity>
      <Text style={styles.baslik}>📖 Rüya Günlüğü</Text>
      <Text style={styles.altyazi}>{gunluk.length} rüya kaydedildi</Text>
      {gunluk.length === 0
        ? <View style={styles.bosKutu}><Text style={styles.bosYazi}>Henüz rüya yok</Text><Text style={styles.bosAlt}>İlk rüyanı yorumladığında burada görünecek</Text></View>
        : gunluk.map((kayit) => (
          <TouchableOpacity key={kayit.id} style={styles.gunlukKart} onPress={() => { setSeciliKayit(kayit); setEkran('detay'); }}>
            <View style={styles.gunlukKartUst}>
              <View style={[styles.miniBadge, { backgroundColor: duyguRenk[kayit.analiz.duygu] + '22' }]}>
                <Text style={{ color: duyguRenk[kayit.analiz.duygu], fontSize: 11, fontWeight: 'bold' }}>
                  {duyguEmoji[kayit.analiz.duygu]} {kayit.analiz.duygu}
                </Text>
              </View>
              <Text style={styles.tarihYazi}>{tarihleriFormatla(kayit.tarih)}</Text>
            </View>
            <Text style={styles.gunlukOzet} numberOfLines={2}>"{kayit.analiz.ozet}"</Text>
            <Text style={styles.gunlukRuya} numberOfLines={1}>{kayit.ruya}</Text>
          </TouchableOpacity>
        ))
      }
      <View style={{ height: 40 }} />
    </ScrollView>
  );

  // ── DETAY EKRANI ──
  if (ekran === 'detay' && seciliKayit) return (
    <ScrollView style={styles.container} contentContainerStyle={styles.icerik}>
      <View style={styles.detayHeader}>
        <TouchableOpacity onPress={() => setEkran('gunluk')} style={styles.geriButon}>
          <Text style={styles.geriYazi}>← Günlük</Text>
        </TouchableOpacity>
        <TouchableOpacity onPress={() => kayitSil(seciliKayit.id)}>
          <Text style={styles.silYazi}>Sil</Text>
        </TouchableOpacity>
      </View>
      <Text style={styles.tarihBuyuk}>{tarihleriFormatla(seciliKayit.tarih)}</Text>
      <View style={[styles.duyguKart, { borderColor: duyguRenk[seciliKayit.analiz.duygu] + '44', backgroundColor: duyguRenk[seciliKayit.analiz.duygu] + '11' }]}>
        <Text style={styles.duyguEmoji}>{duyguEmoji[seciliKayit.analiz.duygu]}</Text>
        <Text style={[styles.duyguYazi, { color: duyguRenk[seciliKayit.analiz.duygu] }]}>{seciliKayit.analiz.duygu.toUpperCase()}</Text>
      </View>
      <Text style={styles.ozet}>"{seciliKayit.analiz.ozet}"</Text>
      {seciliKayit.imageUrl && <Image source={{ uri: seciliKayit.imageUrl }} style={styles.detayGorsel} resizeMode="cover" />}
      <Text style={styles.bolumBaslik}>📝 Rüya</Text>
      <View style={styles.bolumKutu}><Text style={styles.yorumYazi}>{seciliKayit.ruya}</Text></View>
      <Text style={styles.bolumBaslik}>📖 Yorum</Text>
      <View style={styles.bolumKutu}><Text style={styles.yorumYazi}>{seciliKayit.analiz.yorum}</Text></View>
      <Text style={styles.bolumBaslik}>🔮 Semboller</Text>
      {seciliKayit.analiz.semboller.map((s, i) => (
        <View key={i} style={styles.sembolKart}>
          <View style={styles.sembolNo}><Text style={styles.sembolNoYazi}>{i + 1}</Text></View>
          <View style={{ flex: 1 }}><Text style={styles.sembolIsim}>{s.isim}</Text><Text style={styles.sembolAnlam}>{s.anlam}</Text></View>
        </View>
      ))}
      <View style={{ height: 40 }} />
    </ScrollView>
  );
// ── ONBOARDING EKRANI ──
if (ekran === 'onboarding') {
  const slides = [
    { emoji: '🌙', baslik: 'Morpheus\'a Hoş Geldin', aciklama: 'Rüyalarının gizli anlamlarını keşfet. Bilinçaltın sana bir şeyler söylüyor.' },
    { emoji: '✨', baslik: 'AI ile Derin Analiz', aciklama: 'Yapay zeka rüyanı analiz eder, semboller çözer, psikolojik yorum yapar.' },
    { emoji: '🖼️', baslik: 'Rüyanı Görsele Çevir', aciklama: 'Her rüyan benzersiz bir sanat eserine dönüşür. Paylaş, kaydet, sakla.' },
    { emoji: '📖', baslik: 'Kişisel Rüya Günlüğün', aciklama: 'Tüm rüyaların kaydedilir. Zaman içinde örüntüleri keşfet.' },
  ];


  const ileri = async () => {
    if (aktifSlide < slides.length - 1) {
      setAktifSlide(aktifSlide + 1);
    } else {
      await AsyncStorage.setItem('onboarding_goruldu', 'evet');
      setEkran('ana');
    }
  };

  const atla = async () => {
    await AsyncStorage.setItem('onboarding_goruldu', 'evet');
    setEkran('ana');
  };

  const slide = slides[aktifSlide];

  return (
    <LinearGradient colors={['#070714', '#0d0b2e', '#070714']} style={styles.onboardingContainer}>
      <TouchableOpacity onPress={atla} style={styles.atlaButon}>
        <Text style={styles.atlaYazi}>Atla</Text>
      </TouchableOpacity>

      <View style={styles.onboardingIcerik}>
        <Text style={styles.onboardingEmoji}>{slide.emoji}</Text>
        <Text style={styles.onboardingBaslik}>{slide.baslik}</Text>
        <Text style={styles.onboardingAciklama}>{slide.aciklama}</Text>
      </View>

      <View style={styles.onboardingAlt}>
        <View style={styles.noktalar}>
          {slides.map((_, i) => (
            <View key={i} style={[styles.nokta, i === aktifSlide && styles.noktaAktif]} />
          ))}
        </View>

        <TouchableOpacity style={styles.ileriButon} onPress={ileri}>
          <Text style={styles.ileriYazi}>
            {aktifSlide === slides.length - 1 ? 'Başla 🌙' : 'İleri →'}
          </Text>
        </TouchableOpacity>
      </View>
    </LinearGradient>
  );
}
// ── İSTATİSTİK EKRANI ──
if (ekran === 'istatistik') {
  const toplamRuya = gunluk.length;
  const duyguSayilari = gunluk.reduce((acc, k) => {
    acc[k.analiz.duygu] = (acc[k.analiz.duygu] || 0) + 1;
    return acc;
  }, {} as Record<string, number>);

  const enCokDuygu = Object.entries(duyguSayilari).sort((a, b) => b[1] - a[1])[0];
  const gorselliRuya = gunluk.filter(k => k.imageUrl).length;
  const buHafta = gunluk.filter(k => {
    const tarih = new Date(k.tarih);
    const simdi = new Date();
    const fark = (simdi.getTime() - tarih.getTime()) / (1000 * 60 * 60 * 24);
    return fark <= 7;
  }).length;

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.icerik}>
      <TouchableOpacity onPress={() => setEkran('ana')} style={styles.geriButon}>
        <Text style={styles.geriYazi}>← Geri</Text>
      </TouchableOpacity>

      <Text style={styles.baslik}>📊 İstatistikler</Text>
      <Text style={styles.altyazi}>Rüya örüntülerini keşfet</Text>

      {toplamRuya === 0 ? (
        <View style={styles.bosKutu}>
          <Text style={styles.bosYazi}>Henüz veri yok</Text>
          <Text style={styles.bosAlt}>Rüya yorumladıkça istatistiklerin burada görünür</Text>
        </View>
      ) : (
        <>
          {/* Özet kartlar */}
          <View style={styles.istatKartlar}>
            <View style={styles.istatKart}>
              <Text style={styles.istatSayi}>{toplamRuya}</Text>
              <Text style={styles.istatLabel}>Toplam Rüya</Text>
            </View>
            <View style={styles.istatKart}>
              <Text style={styles.istatSayi}>{buHafta}</Text>
              <Text style={styles.istatLabel}>Bu Hafta</Text>
            </View>
            <View style={styles.istatKart}>
              <Text style={styles.istatSayi}>{gorselliRuya}</Text>
              <Text style={styles.istatLabel}>Görsel</Text>
            </View>
          </View>

          {/* En çok duygu */}
          {enCokDuygu && (
            <View style={[styles.enCokKart, { borderColor: duyguRenk[enCokDuygu[0] as DuyguTipi] + '44', backgroundColor: duyguRenk[enCokDuygu[0] as DuyguTipi] + '11' }]}>
              <Text style={styles.enCokBaslik}>En Çok Hissedilen</Text>
              <Text style={styles.enCokEmoji}>{duyguEmoji[enCokDuygu[0] as DuyguTipi]}</Text>
              <Text style={[styles.enCokDuygu, { color: duyguRenk[enCokDuygu[0] as DuyguTipi] }]}>
                {enCokDuygu[0].toUpperCase()}
              </Text>
              <Text style={styles.enCokSayi}>{enCokDuygu[1]} rüyada</Text>
            </View>
          )}

          {/* Duygu dağılımı */}
          <Text style={styles.bolumBaslik}>Duygu Dağılımı</Text>
          {Object.entries(duyguSayilari).sort((a, b) => b[1] - a[1]).map(([duygu, sayi]) => (
            <View key={duygu} style={styles.duyguSatir}>
              <View style={styles.duyguSatirSol}>
                <Text style={styles.duyguSatirEmoji}>{duyguEmoji[duygu as DuyguTipi]}</Text>
                <Text style={styles.duyguSatirIsim}>{duygu}</Text>
              </View>
              <View style={styles.barContainer}>
                <View style={[styles.bar, {
                  width: `${(sayi / toplamRuya) * 100}%` as any,
                  backgroundColor: duyguRenk[duygu as DuyguTipi],
                }]} />
              </View>
              <Text style={[styles.duyguSatirSayi, { color: duyguRenk[duygu as DuyguTipi] }]}>{sayi}</Text>
            </View>
          ))}

          {/* Son rüyalar */}
          <Text style={styles.bolumBaslik}>Son 7 Gün</Text>
          {gunluk.slice(0, 5).map((kayit) => (
            <TouchableOpacity key={kayit.id} style={styles.gunlukKart} onPress={() => { setSeciliKayit(kayit); setEkran('detay'); }}>
              <View style={styles.gunlukKartUst}>
                <View style={[styles.miniBadge, { backgroundColor: duyguRenk[kayit.analiz.duygu] + '22' }]}>
                  <Text style={{ color: duyguRenk[kayit.analiz.duygu], fontSize: 11, fontWeight: 'bold' }}>
                    {duyguEmoji[kayit.analiz.duygu]} {kayit.analiz.duygu}
                  </Text>
                </View>
                <Text style={styles.tarihYazi}>{tarihleriFormatla(kayit.tarih)}</Text>
              </View>
              <Text style={styles.gunlukOzet} numberOfLines={1}>"{kayit.analiz.ozet}"</Text>
            </TouchableOpacity>
          ))}
        </>
      )}
      <View style={{ height: 40 }} />
    </ScrollView>
  );
}
  return null;
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#070714' },
  icerik: { padding: 24, paddingTop: 64 },
  baslik: { color: '#fff', fontSize: 26, fontWeight: 'bold', marginBottom: 6 },
  altyazi: { color: '#444', fontSize: 14, fontStyle: 'italic', marginBottom: 32 },
  inputKart: { backgroundColor: '#0f0f24', borderRadius: 20, padding: 20, borderWidth: 1, borderColor: '#1e1e3f', marginBottom: 16 },
  inputLabel: { color: '#444', fontSize: 11, letterSpacing: 1, marginBottom: 10 },
  input: { color: '#ddd', fontSize: 15, lineHeight: 24, minHeight: 120, textAlignVertical: 'top' },
  inputAlt: { flexDirection: 'row', justifyContent: 'space-between', marginTop: 12, paddingTop: 12, borderTopWidth: 1, borderTopColor: '#1a1a35' },
  ipucu: { color: '#444', fontSize: 12 },
  sayac: { color: '#333', fontSize: 12 },
  buton: { backgroundColor: '#6c47ff', borderRadius: 18, padding: 18, alignItems: 'center', marginBottom: 32, shadowColor: '#6c47ff', shadowOffset: { width: 0, height: 8 }, shadowOpacity: 0.4, shadowRadius: 16, elevation: 8 },
  butonDevre: { backgroundColor: '#1a1a2e', shadowOpacity: 0 },
  butonYazi: { color: '#fff', fontWeight: 'bold', fontSize: 16 },
  yukleniyorSatir: { flexDirection: 'row', alignItems: 'center' },
  bolumBaslik: { color: '#fff', fontSize: 15, fontWeight: 'bold', marginBottom: 12, marginTop: 8 },
  bolumKutu: { backgroundColor: '#0f0f24', borderRadius: 16, padding: 18, borderWidth: 1, borderColor: '#1e1e3f', marginBottom: 24 },
  gunlukKart: { backgroundColor: '#0f0f24', borderRadius: 16, padding: 16, marginBottom: 12, borderWidth: 1, borderColor: '#1e1e3f' },
  gunlukKartUst: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 },
  miniBadge: { paddingHorizontal: 10, paddingVertical: 4, borderRadius: 12 },
  tarihYazi: { color: '#444', fontSize: 12 },
  gunlukOzet: { color: '#888', fontStyle: 'italic', fontSize: 13, lineHeight: 20, marginBottom: 4 },
  gunlukRuya: { color: '#333', fontSize: 12 },
  tumunuGor: { alignItems: 'center', padding: 12 },
  tumunuGorYazi: { color: '#6c47ff', fontSize: 14 },
  gunlukButon: { position: 'absolute', bottom: 24, right: 24, backgroundColor: '#6c47ff', borderRadius: 30, paddingHorizontal: 16, paddingVertical: 12, shadowColor: '#6c47ff', shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.4, shadowRadius: 12, elevation: 8 },
  gunlukButonYazi: { color: '#fff', fontWeight: 'bold', fontSize: 14 },
  geriButon: { marginBottom: 24 },
  geriYazi: { color: '#6c47ff', fontSize: 14 },
  duyguKart: { flexDirection: 'row', alignItems: 'center', gap: 10, alignSelf: 'flex-start', paddingHorizontal: 16, paddingVertical: 10, borderRadius: 20, borderWidth: 1, marginBottom: 16 },
  duyguEmoji: { fontSize: 20 },
  duyguYazi: { fontWeight: 'bold', fontSize: 14, letterSpacing: 1 },
  ozet: { color: '#888', fontStyle: 'italic', fontSize: 15, lineHeight: 24, marginBottom: 8, borderLeftWidth: 3, borderLeftColor: '#6c47ff', paddingLeft: 16 },
  kaydedildiYazi: { color: '#4ade8066', fontSize: 12, marginBottom: 24, paddingLeft: 16 },
  yorumYazi: { color: '#bbb', fontSize: 14, lineHeight: 26 },
  sembolKart: { flexDirection: 'row', backgroundColor: '#0f0f24', borderRadius: 14, padding: 14, marginBottom: 10, borderWidth: 1, borderColor: '#1e1e3f', gap: 14 },
  sembolNo: { width: 32, height: 32, borderRadius: 10, backgroundColor: '#6c47ff22', alignItems: 'center', justifyContent: 'center' },
  sembolNoYazi: { color: '#6c47ff', fontWeight: 'bold', fontSize: 14 },
  sembolIsim: { color: '#fff', fontWeight: 'bold', fontSize: 14, marginBottom: 4 },
  sembolAnlam: { color: '#555', fontSize: 13, lineHeight: 20 },
  gorselButon: { marginTop: 10, marginBottom: 10, backgroundColor: '#8b5cf6', borderRadius: 16, padding: 15, alignItems: 'center' },
  gorselButonYazi: { color: '#fff', fontSize: 14, fontWeight: '700' },
  yeniButon: { marginTop: 10, padding: 14, borderRadius: 16, borderWidth: 1, borderColor: '#6c47ff33', alignItems: 'center', backgroundColor: '#6c47ff11' },
  yeniButonYazi: { color: '#6c47ff', fontSize: 14 },
  modalOverlay: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, zIndex: 999 },
  modalArka: { flex: 1, backgroundColor: 'rgba(0,0,0,0.85)', justifyContent: 'center', padding: 18 },
  modalKart: { backgroundColor: '#101225', borderRadius: 20, padding: 18, maxHeight: '88%', borderWidth: 1, borderColor: '#2a2a4e' },
  modalBaslik: { color: '#fff', fontSize: 20, fontWeight: 'bold', marginBottom: 16 },
  modalYukleniyor: { paddingVertical: 40, alignItems: 'center' },
  modalYazi: { color: '#c9c9dd', marginTop: 12, textAlign: 'center' },
  hataKutu: { backgroundColor: '#1a0808', borderRadius: 12, padding: 16, marginBottom: 16 },
  hataYazi: { color: '#ff9999', fontSize: 13, lineHeight: 20 },
  gorsel: { width: '100%', height: 420, borderRadius: 16, backgroundColor: '#1b1f39' },
  kapatButon: { marginTop: 12, padding: 12, borderRadius: 14, borderWidth: 1, borderColor: '#40446d', alignItems: 'center' },
  kapatButonYazi: { color: '#c7c9de', fontWeight: '600' },
  bosKutu: { alignItems: 'center', paddingVertical: 60 },
  bosYazi: { color: '#444', fontSize: 18, marginBottom: 8 },
  bosAlt: { color: '#333', fontSize: 13, textAlign: 'center' },
  detayHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 },
  tarihBuyuk: { color: '#555', fontSize: 14, marginBottom: 20 },
  silYazi: { color: '#f87171', fontSize: 14 },
  detayGorsel: { width: '100%', height: 300, borderRadius: 16, marginBottom: 24, backgroundColor: '#1b1f39' },
  onboardingContainer: { flex: 1, justifyContent: 'space-between', paddingTop: 64, paddingBottom: 48, paddingHorizontal: 24 },
  atlaButon: { alignSelf: 'flex-end' },
  atlaYazi: { color: '#444', fontSize: 14 },
  onboardingIcerik: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  onboardingEmoji: { fontSize: 80, marginBottom: 32 },
  onboardingBaslik: { color: '#fff', fontSize: 26, fontWeight: 'bold', textAlign: 'center', marginBottom: 16, letterSpacing: -0.5 },
  onboardingAciklama: { color: '#666', fontSize: 16, textAlign: 'center', lineHeight: 26 },
  onboardingAlt: { gap: 24 },
  noktalar: { flexDirection: 'row', justifyContent: 'center', gap: 8 },
  nokta: { width: 8, height: 8, borderRadius: 4, backgroundColor: '#222' },
  noktaAktif: { width: 24, backgroundColor: '#6c47ff' },
  ileriButon: { backgroundColor: '#6c47ff', borderRadius: 18, padding: 18, alignItems: 'center', shadowColor: '#6c47ff', shadowOffset: { width: 0, height: 8 }, shadowOpacity: 0.4, shadowRadius: 16, elevation: 8 },
  ileriYazi: { color: '#fff', fontWeight: 'bold', fontSize: 16 },
  paylasButon: { marginTop: 12, backgroundColor: '#1a1a3e', borderRadius: 14, padding: 14, alignItems: 'center', borderWidth: 1, borderColor: '#6c47ff44' },
  paylasYazi: { color: '#6c47ff', fontWeight: 'bold', fontSize: 15 },
  istatKartlar: { flexDirection: 'row', gap: 12, marginBottom: 24 },
  istatKart: { flex: 1, backgroundColor: '#0f0f24', borderRadius: 16, padding: 16, alignItems: 'center', borderWidth: 1, borderColor: '#1e1e3f' },
  istatSayi: { color: '#fff', fontSize: 28, fontWeight: 'bold', marginBottom: 4 },
  istatLabel: { color: '#555', fontSize: 12 },
  enCokKart: { borderRadius: 20, borderWidth: 1, padding: 24, alignItems: 'center', marginBottom: 24 },
  enCokBaslik: { color: '#555', fontSize: 12, letterSpacing: 1, marginBottom: 12 },
  enCokEmoji: { fontSize: 40, marginBottom: 8 },
  enCokDuygu: { fontSize: 20, fontWeight: 'bold', marginBottom: 4 },
  enCokSayi: { color: '#555', fontSize: 13 },
  duyguSatir: { flexDirection: 'row', alignItems: 'center', marginBottom: 12, gap: 10 },
  duyguSatirSol: { flexDirection: 'row', alignItems: 'center', gap: 6, width: 100 },
  duyguSatirEmoji: { fontSize: 16 },
  duyguSatirIsim: { color: '#888', fontSize: 13 },
  barContainer: { flex: 1, height: 8, backgroundColor: '#1a1a2e', borderRadius: 4, overflow: 'hidden' },
  bar: { height: 8, borderRadius: 4 },
  duyguSatirSayi: { width: 20, textAlign: 'right', fontSize: 13, fontWeight: 'bold' },
  altButonlar: { position: 'absolute', bottom: 24, right: 24, gap: 12, flexDirection: 'column', alignItems: 'flex-end' },
});