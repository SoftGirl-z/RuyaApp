import AsyncStorage from '@react-native-async-storage/async-storage';
import { LinearGradient } from 'expo-linear-gradient';
import * as Sharing from 'expo-sharing';
import { useMemo, useState, useEffect, useCallback } from 'react';
import {
  Alert, ActivityIndicator, Image, Pressable, ScrollView,
  StyleSheet, Text, TextInput, TouchableOpacity, View, KeyboardAvoidingView, Platform,
} from 'react-native';
import {
  createUserWithEmailAndPassword, signInWithEmailAndPassword,
  signOut, onAuthStateChanged, User, updateProfile,
} from 'firebase/auth';
import { doc, setDoc, collection, addDoc, getDocs, deleteDoc, query, orderBy } from 'firebase/firestore';
import { auth, db } from './firebase';

const GEMINI_KEY = 'AIzaSyD-LtetwCHwgIx2GbckOYiSNH91ljgOotI';

const duyguRenk = {
  huzurlu: '#4ade80', kaygili: '#fb923c', heyecanli: '#60a5fa',
  karisik: '#c084fc', korkutucu: '#f87171',
} as const;

const duyguEmoji = {
  huzurlu: '🌿', kaygili: '😰', heyecanli: '⚡', karisik: '🌀', korkutucu: '👁',
} as const;

type DuyguTipi = keyof typeof duyguRenk;
type SembolTipi = { isim: string; anlam: string };
type AnalizTipi = { yorum: string; semboller: SembolTipi[]; duygu: DuyguTipi; ozet: string };
type GorselDurumu = { acik: boolean; yukleniyor: boolean; prompt: string; imageUrl: string | null; hata: string | null };
type GunlukKayit = { id: string; ruya: string; analiz: AnalizTipi; tarih: string; imageUrl?: string };
type AnaEkran = 'ana' | 'gunluk' | 'istatistik';

const defaultGorsel: GorselDurumu = { acik: false, yukleniyor: false, prompt: '', imageUrl: null, hata: null };

function temizleKodBloklari(t: string) { return t.replace(/```json|```/g, '').trim(); }
function duyguGecerliMi(v: unknown): v is DuyguTipi { return typeof v === 'string' && v in duyguRenk; }

function guvenliAnalizParse(text: string): AnalizTipi {
  const clean = temizleKodBloklari(text);
  try {
    const p = JSON.parse(clean) as any;
    const semboller: SembolTipi[] = Array.isArray(p.semboller)
      ? p.semboller.filter((i: unknown): i is SembolTipi =>
          typeof i === 'object' && i !== null &&
          typeof (i as SembolTipi).isim === 'string' &&
          typeof (i as SembolTipi).anlam === 'string')
      : [];
    return {
      yorum: typeof p.yorum === 'string' ? p.yorum : clean,
      semboller,
      duygu: duyguGecerliMi(p.duygu) ? p.duygu : 'karisik',
      ozet: typeof p.ozet === 'string' && p.ozet.trim() ? p.ozet : 'Özet oluşturulamadı.',
    };
  } catch {
    return { yorum: clean || 'Yorum üretilemedi.', semboller: [], duygu: 'karisik', ozet: 'Yanıt işlenemedi.' };
  }
}

function gorselPromptOlustur(a: AnalizTipi) {
  const s = a.semboller.length ? a.semboller.map(x => x.isim).join(', ') : 'soyut rüya sembolleri';
  return `Create a dreamlike cinematic illustration: "${a.ozet}". Mood: ${a.duygu}. Symbols: ${s}. Surreal, mystical, moonlight, no text.`;
}

function tarihleriFormatla(iso: string) {
  return new Date(iso).toLocaleDateString('tr-TR', { day: 'numeric', month: 'long', year: 'numeric' });
}

export default function App() {
  const [kullanici, setKullanici] = useState<User | null>(null);
  const [authYukleniyor, setAuthYukleniyor] = useState(true);
  const [authEkran, setAuthEkran] = useState<'giris' | 'kayit'>('giris');
  const [email, setEmail] = useState('');
  const [sifre, setSifre] = useState('');
  const [ad, setAd] = useState('');
  const [authIslem, setAuthIslem] = useState(false);
  const [onboardingGoruldu, setOnboardingGoruldu] = useState(false);
  const [aktifTab, setAktifTab] = useState<AnaEkran>('ana');
  const [profilAcik, setProfilAcik] = useState(false);
  const [detayKayit, setDetayKayit] = useState<GunlukKayit | null>(null);
  const [aktifSlide, setAktifSlide] = useState(0);
  const [ruya, setRuya] = useState('');
  const [yukleniyor, setYukleniyor] = useState(false);
  const [analiz, setAnaliz] = useState<AnalizTipi | null>(null);
  const [yorumEkrani, setYorumEkrani] = useState(false);
  const [gorsel, setGorsel] = useState<GorselDurumu>(defaultGorsel);
  const [gunluk, setGunluk] = useState<GunlukKayit[]>([]);
  const [gunlukYukleniyor, setGunlukYukleniyor] = useState(false);

  useEffect(() => {
    const unsub = onAuthStateChanged(auth, async (user) => {
      setKullanici(user);
      setAuthYukleniyor(false);
      if (user) {
        const goruldu = await AsyncStorage.getItem(`onboarding_${user.uid}`);
        setOnboardingGoruldu(!!goruldu);
        gunluguYukle(user.uid);
      }
    });
    return unsub;
  }, []);

  const gunluguYukle = async (uid: string) => {
    setGunlukYukleniyor(true);
    try {
      const q = query(collection(db, 'kullanicilar', uid, 'ruyalar'), orderBy('tarih', 'desc'));
      const snap = await getDocs(q);
      setGunluk(snap.docs.map(d => ({ id: d.id, ...d.data() } as GunlukKayit)));
    } catch {
      try {
        const json = await AsyncStorage.getItem(`gunluk_${uid}`);
        if (json) setGunluk(JSON.parse(json));
      } catch {}
    } finally { setGunlukYukleniyor(false); }
  };

  const kayitEkle = async (analizVeri: AnalizTipi, ruyaMetni: string) => {
    if (!kullanici) return;
    const yeni = { ruya: ruyaMetni, analiz: analizVeri, tarih: new Date().toISOString() };
    try {
      const ref = await addDoc(collection(db, 'kullanicilar', kullanici.uid, 'ruyalar'), yeni);
      setGunluk(prev => [{ id: ref.id, ...yeni }, ...prev]);
    } catch {
      const yeniKayit = { id: Date.now().toString(), ...yeni };
      setGunluk(prev => {
        const g = [yeniKayit, ...prev];
        AsyncStorage.setItem(`gunluk_${kullanici.uid}`, JSON.stringify(g));
        return g;
      });
    }
  };

  const kayitSil = async (id: string) => {
    Alert.alert('Sil', 'Bu rüyayı silmek istiyor musun?', [
      { text: 'İptal', style: 'cancel' },
      { text: 'Sil', style: 'destructive', onPress: async () => {
        if (kullanici) try { await deleteDoc(doc(db, 'kullanicilar', kullanici.uid, 'ruyalar', id)); } catch {}
        setGunluk(prev => prev.filter(k => k.id !== id));
        setDetayKayit(null);
      }},
    ]);
  };

  const girisYap = async () => {
    if (!email || !sifre) { Alert.alert('Hata', 'Email ve şifre gir.'); return; }
    setAuthIslem(true);
    try { await signInWithEmailAndPassword(auth, email, sifre); }
    catch (e: any) { Alert.alert('Giriş Hatası', 'Email veya şifre hatalı.'); }
    finally { setAuthIslem(false); }
  };

  const kayitOl = async () => {
    if (!ad || !email || !sifre) { Alert.alert('Hata', 'Tüm alanları doldur.'); return; }
    if (sifre.length < 6) { Alert.alert('Hata', 'Şifre en az 6 karakter olmalı.'); return; }
    setAuthIslem(true);
    try {
      const { user } = await createUserWithEmailAndPassword(auth, email, sifre);
      await updateProfile(user, { displayName: ad });
      await setDoc(doc(db, 'kullanicilar', user.uid), { ad, email, kayitTarihi: new Date().toISOString() });
    } catch (e: any) { Alert.alert('Kayıt Hatası', e.message.includes('email-already-in-use') ? 'Bu email zaten kullanımda.' : 'Kayıt başarısız.'); }
    finally { setAuthIslem(false); }
  };

  const cikisYap = () => {
    Alert.alert('Çıkış', 'Çıkış yapmak istiyor musun?', [
      { text: 'İptal', style: 'cancel' },
      { text: 'Çıkış', style: 'destructive', onPress: async () => { await signOut(auth); setGunluk([]); setProfilAcik(false); } },
    ]);
  };

  const analizPrompt = useMemo(() => `Sen deneyimli bir rüya analisti ve psikoloji uzmanısın.
Aşağıdaki rüyayı analiz et ve SADECE şu JSON formatında yanıt ver, başka hiçbir şey yazma:
{
  "yorum": "200 kelimelik derin psikolojik yorum",
  "semboller": [{"isim": "sembol adı", "anlam": "sembolün anlamı"}, {"isim": "sembol adı", "anlam": "sembolün anlamı"}],
  "duygu": "huzurlu veya kaygili veya heyecanli veya karisik veya korkutucu",
  "ozet": "tek cümlelik özet"
}
Rüya: "${ruya}"`, [ruya]);

  const yorumla = async () => {
    if (ruya.trim().length < 20) { Alert.alert('Uyarı', 'Biraz daha detaylı yaz.'); return; }
    setYukleniyor(true); setAnaliz(null);
    try {
      const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${GEMINI_KEY}`,
        { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ contents: [{ parts: [{ text: analizPrompt }] }] }) });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error?.message || `HTTP ${res.status}`);
      const text = data?.candidates?.[0]?.content?.parts?.[0]?.text;
      if (!text) throw new Error('Modelden geçerli analiz dönmedi.');
      const parsed = guvenliAnalizParse(text);
      setAnaliz(parsed); setYorumEkrani(true);
      await kayitEkle(parsed, ruya);
    } catch (e: unknown) { Alert.alert('Hata', e instanceof Error ? e.message : 'Yorum alınamadı.'); }
    finally { setYukleniyor(false); }
  };

  const gorselOlustur = async () => {
    if (!analiz) return;
    const prompt = gorselPromptOlustur(analiz);
    setGorsel({ acik: true, yukleniyor: true, prompt, imageUrl: null, hata: null });
    try {
      const res = await fetch( `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-image:generateContent?key=${GEMINI_KEY}`,
        { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }], generationConfig: { responseModalities: ['IMAGE', 'TEXT'] } }) });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error?.message || `HTTP ${res.status}`);
      const imgPart = (data?.candidates?.[0]?.content?.parts || []).find((p: any) => p?.inlineData?.data);
      if (!imgPart) throw new Error('Görsel verisi gelmedi.');
      setGorsel({ acik: true, yukleniyor: false, prompt, imageUrl: `data:image/png;base64,${imgPart.inlineData.data}`, hata: null });
    } catch (e: any) { setGorsel({ acik: true, yukleniyor: false, prompt, imageUrl: null, hata: e.message }); }
  };

  const gorselPaylas = async (imageUrl: string) => {
    try {
      const FS = require('expo-file-system');
      const yol = `${FS.documentDirectory}morpheus_ruya.png`;
      await FS.writeAsStringAsync(yol, imageUrl.replace('data:image/png;base64,', ''), { encoding: FS.EncodingType.Base64 });
      await Sharing.shareAsync(yol, { mimeType: 'image/png', dialogTitle: 'Rüyamı Paylaş' });
    } catch (e: any) { Alert.alert('Hata', e.message); }
  };

  // LOADING
  if (authYukleniyor) return (
    <View style={s.loadingEkran}><Text style={{ fontSize: 48, marginBottom: 24 }}>🌙</Text><ActivityIndicator color="#6c47ff" size="large" /></View>
  );

  // ONBOARDING
  if (kullanici && !onboardingGoruldu) {
    const slides = [
      { emoji: '🌙', baslik: "Morpheus'a Hoş Geldin", aciklama: 'Rüyalarının gizli anlamlarını keşfet.' },
      { emoji: '✨', baslik: 'AI ile Derin Analiz', aciklama: 'Yapay zeka rüyanı analiz eder, semboller çözer.' },
      { emoji: '🖼️', baslik: 'Rüyanı Görsele Çevir', aciklama: 'Her rüyan benzersiz bir sanat eserine dönüşür.' },
      { emoji: '☁️', baslik: 'Buluta Kaydedilir', aciklama: 'Tüm rüyaların her cihazdan erişilebilir.' },
    ];
    const slide = slides[aktifSlide];
    const ileri = async () => {
      if (aktifSlide < slides.length - 1) setAktifSlide(aktifSlide + 1);
      else { await AsyncStorage.setItem(`onboarding_${kullanici.uid}`, 'evet'); setOnboardingGoruldu(true); }
    };
    const atla = async () => { await AsyncStorage.setItem(`onboarding_${kullanici.uid}`, 'evet'); setOnboardingGoruldu(true); };
    return (
      <LinearGradient colors={['#070714', '#0d0b2e', '#070714']} style={s.onboardingContainer}>
        <TouchableOpacity onPress={atla} style={s.atlaButon}><Text style={s.atlaYazi}>Atla</Text></TouchableOpacity>
        <View style={s.onboardingIcerik}>
          <Text style={s.onboardingEmoji}>{slide.emoji}</Text>
          <Text style={s.onboardingBaslik}>{slide.baslik}</Text>
          <Text style={s.onboardingAciklama}>{slide.aciklama}</Text>
        </View>
        <View style={s.onboardingAlt}>
          <View style={s.noktalar}>{slides.map((_, i) => <View key={i} style={[s.nokta, i === aktifSlide && s.noktaAktif]} />)}</View>
          <TouchableOpacity style={s.ileriButon} onPress={ileri}>
            <Text style={s.ileriYazi}>{aktifSlide === slides.length - 1 ? 'Başla 🌙' : 'İleri →'}</Text>
          </TouchableOpacity>
        </View>
      </LinearGradient>
    );
  }

  // AUTH
  if (!kullanici) return (
    <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <ScrollView style={s.container} contentContainerStyle={{ padding: 24, paddingTop: 80 }}>
        <View style={{ alignItems: 'center', marginBottom: 48 }}>
          <Text style={{ fontSize: 56, marginBottom: 16 }}>🌙</Text>
          <Text style={s.baslik}>Morpheus</Text>
          <Text style={s.altyazi}>Rüyalarının anlamını keşfet</Text>
        </View>
        <View style={s.authTab}>
          <TouchableOpacity style={[s.authTabButon, authEkran === 'giris' && s.authTabAktif]} onPress={() => setAuthEkran('giris')}>
            <Text style={[s.authTabYazi, authEkran === 'giris' && s.authTabYaziAktif]}>Giriş Yap</Text>
          </TouchableOpacity>
          <TouchableOpacity style={[s.authTabButon, authEkran === 'kayit' && s.authTabAktif]} onPress={() => setAuthEkran('kayit')}>
            <Text style={[s.authTabYazi, authEkran === 'kayit' && s.authTabYaziAktif]}>Kayıt Ol</Text>
          </TouchableOpacity>
        </View>
        <View style={{ gap: 12 }}>
          {authEkran === 'kayit' && <TextInput style={s.authInput} placeholder="Adın" placeholderTextColor="#444" value={ad} onChangeText={setAd} />}
          <TextInput style={s.authInput} placeholder="Email" placeholderTextColor="#444" value={email} onChangeText={setEmail} keyboardType="email-address" autoCapitalize="none" />
          <TextInput style={s.authInput} placeholder="Şifre (en az 6 karakter)" placeholderTextColor="#444" value={sifre} onChangeText={setSifre} secureTextEntry />
          <TouchableOpacity style={s.buton} onPress={authEkran === 'giris' ? girisYap : kayitOl} disabled={authIslem}>
            {authIslem ? <ActivityIndicator color="#fff" /> : <Text style={s.butonYazi}>{authEkran === 'giris' ? 'Giriş Yap' : 'Kayıt Ol'}</Text>}
          </TouchableOpacity>
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );

  const profilHarf = (kullanici.displayName || kullanici.email || '?')[0].toUpperCase();

  // DETAY EKRANI
  if (detayKayit) return (
    <View style={{ flex: 1 }}>
      <ScrollView style={s.container} contentContainerStyle={s.icerik}>
        <View style={s.detayHeader}>
          <TouchableOpacity onPress={() => setDetayKayit(null)} style={s.geriButon}><Text style={s.geriYazi}>← Geri</Text></TouchableOpacity>
          <TouchableOpacity onPress={() => kayitSil(detayKayit.id)}><Text style={s.silYazi}>Sil</Text></TouchableOpacity>
        </View>
        <Text style={s.tarihBuyuk}>{tarihleriFormatla(detayKayit.tarih)}</Text>
        <View style={[s.duyguKart, { borderColor: duyguRenk[detayKayit.analiz.duygu] + '44', backgroundColor: duyguRenk[detayKayit.analiz.duygu] + '11' }]}>
          <Text style={s.duyguEmoji}>{duyguEmoji[detayKayit.analiz.duygu]}</Text>
          <Text style={[s.duyguYazi, { color: duyguRenk[detayKayit.analiz.duygu] }]}>{detayKayit.analiz.duygu.toUpperCase()}</Text>
        </View>
        <Text style={s.ozet}>"{detayKayit.analiz.ozet}"</Text>
        {detayKayit.imageUrl && <Image source={{ uri: detayKayit.imageUrl }} style={s.detayGorsel} resizeMode="cover" />}
        <Text style={s.bolumBaslik}>📝 Rüya</Text>
        <View style={s.bolumKutu}><Text style={s.yorumYazi}>{detayKayit.ruya}</Text></View>
        <Text style={s.bolumBaslik}>📖 Yorum</Text>
        <View style={s.bolumKutu}><Text style={s.yorumYazi}>{detayKayit.analiz.yorum}</Text></View>
        <Text style={s.bolumBaslik}>🔮 Semboller</Text>
        {detayKayit.analiz.semboller.map((sm, i) => (
          <View key={i} style={s.sembolKart}>
            <View style={s.sembolNo}><Text style={s.sembolNoYazi}>{i + 1}</Text></View>
            <View style={{ flex: 1 }}><Text style={s.sembolIsim}>{sm.isim}</Text><Text style={s.sembolAnlam}>{sm.anlam}</Text></View>
          </View>
        ))}
        <View style={{ height: 40 }} />
      </ScrollView>
    </View>
  );

  // YORUM EKRANI
  if (yorumEkrani && analiz) return (
    <View style={{ flex: 1 }}>
      <ScrollView style={s.container} contentContainerStyle={s.icerik}>
        <TouchableOpacity onPress={() => { setYorumEkrani(false); setRuya(''); }} style={s.geriButon}><Text style={s.geriYazi}>← Geri</Text></TouchableOpacity>
        <View style={[s.duyguKart, { borderColor: duyguRenk[analiz.duygu] + '44', backgroundColor: duyguRenk[analiz.duygu] + '11' }]}>
          <Text style={s.duyguEmoji}>{duyguEmoji[analiz.duygu]}</Text>
          <Text style={[s.duyguYazi, { color: duyguRenk[analiz.duygu] }]}>{analiz.duygu.toUpperCase()}</Text>
        </View>
        <Text style={s.ozet}>"{analiz.ozet}"</Text>
        <Text style={s.kaydedildiYazi}>✓ Buluta kaydedildi</Text>
        <Text style={s.bolumBaslik}>📖 Yorum</Text>
        <View style={s.bolumKutu}><Text style={s.yorumYazi}>{analiz.yorum}</Text></View>
        <Text style={s.bolumBaslik}>🔮 Semboller</Text>
        {analiz.semboller.map((sm, i) => (
          <View key={i} style={s.sembolKart}>
            <View style={s.sembolNo}><Text style={s.sembolNoYazi}>{i + 1}</Text></View>
            <View style={{ flex: 1 }}><Text style={s.sembolIsim}>{sm.isim}</Text><Text style={s.sembolAnlam}>{sm.anlam}</Text></View>
          </View>
        ))}
        <TouchableOpacity style={s.gorselButon} onPress={gorselOlustur}><Text style={s.gorselButonYazi}>🖼️ Rüyayı Görsele Çevir</Text></TouchableOpacity>
        <TouchableOpacity style={s.yeniButon} onPress={() => { setRuya(''); setAnaliz(null); setGorsel(defaultGorsel); setYorumEkrani(false); }}>
          <Text style={s.yeniButonYazi}>+ Yeni Rüya</Text>
        </TouchableOpacity>
        <View style={{ height: 100 }} />
      </ScrollView>
      {gorsel.acik && (
        <View style={s.modalOverlay}>
          <View style={s.modalArka}>
            <View style={s.modalKart}>
              <Text style={s.modalBaslik}>🖼️ Rüya Görseli</Text>
              {gorsel.yukleniyor && <View style={s.modalYukleniyor}><ActivityIndicator size="large" color="#8b5cf6" /><Text style={s.modalYazi}>Oluşturuluyor...</Text></View>}
              {gorsel.hata && <View style={s.hataKutu}><Text style={s.hataYazi}>⚠️ {gorsel.hata}</Text></View>}
              {gorsel.imageUrl && <>
                <Image source={{ uri: gorsel.imageUrl }} style={s.gorsel} resizeMode="cover" />
                <TouchableOpacity style={s.paylasButon} onPress={() => gorselPaylas(gorsel.imageUrl!)}><Text style={s.paylasYazi}>↑ Paylaş</Text></TouchableOpacity>
              </>}
              <Pressable style={s.kapatButon} onPress={() => setGorsel(defaultGorsel)}><Text style={s.kapatButonYazi}>Kapat</Text></Pressable>
            </View>
          </View>
        </View>
      )}
    </View>
  );

  // ANA UYGULAMA
  return (
    <View style={{ flex: 1, backgroundColor: '#070714' }}>
      <View style={{ flex: 1 }}>

        {/* ANA SAYFA */}
        {aktifTab === 'ana' && (
          <ScrollView style={s.container} contentContainerStyle={s.icerik}>
            <View style={s.anaHeader}>
              <View>
                <Text style={s.baslik}>🌙 Morpheus</Text>
                <Text style={s.altyazi}>Merhaba, {kullanici.displayName || 'Rüyacı'} 👋</Text>
              </View>
              <TouchableOpacity onPress={() => setProfilAcik(true)} style={s.profilIkon}>
                <Text style={s.profilHarf}>{profilHarf}</Text>
              </TouchableOpacity>
            </View>
            <View style={s.inputKart}>
              <Text style={s.inputLabel}>RÜYANI ANLAT</Text>
              <TextInput style={s.input} multiline placeholder="Bu gece rüyamda..." placeholderTextColor="#333" value={ruya} onChangeText={setRuya} maxLength={800} />
              <View style={s.inputAlt}>
                <Text style={s.ipucu}>{ruya.length < 20 ? `${20 - ruya.length} karakter daha` : '✓ Hazır'}</Text>
                <Text style={s.sayac}>{ruya.length}/800</Text>
              </View>
            </View>
            <TouchableOpacity style={[s.buton, ruya.trim().length < 20 && s.butonDevre]} onPress={yorumla} disabled={yukleniyor || ruya.trim().length < 20}>
              {yukleniyor ? <View style={s.yukleniyorSatir}><ActivityIndicator color="#fff" /><Text style={s.butonYazi}> Analiz ediliyor...</Text></View>
                : <Text style={s.butonYazi}>✨ Yorumla</Text>}
            </TouchableOpacity>
            {gunluk.length > 0 && <>
              <Text style={s.bolumBaslik}>📖 Son Rüyalar</Text>
              {gunluk.slice(0, 3).map(kayit => (
                <TouchableOpacity key={kayit.id} style={s.gunlukKart} onPress={() => setDetayKayit(kayit)}>
                  <View style={s.gunlukKartUst}>
                    <View style={[s.miniBadge, { backgroundColor: duyguRenk[kayit.analiz.duygu] + '22' }]}>
                      <Text style={{ color: duyguRenk[kayit.analiz.duygu], fontSize: 11, fontWeight: 'bold' }}>{duyguEmoji[kayit.analiz.duygu]} {kayit.analiz.duygu}</Text>
                    </View>
                    <Text style={s.tarihYazi}>{tarihleriFormatla(kayit.tarih)}</Text>
                  </View>
                  <Text style={s.gunlukOzet} numberOfLines={2}>"{kayit.analiz.ozet}"</Text>
                </TouchableOpacity>
              ))}
              {gunluk.length > 3 && <TouchableOpacity onPress={() => setAktifTab('gunluk')} style={s.tumunuGor}><Text style={s.tumunuGorYazi}>Tümünü Gör ({gunluk.length}) →</Text></TouchableOpacity>}
            </>}
            <View style={{ height: 100 }} />
          </ScrollView>
        )}

        {/* GÜNLÜK */}
        {aktifTab === 'gunluk' && (
          <ScrollView style={s.container} contentContainerStyle={s.icerik}>
            <View style={s.anaHeader}>
              <View><Text style={s.baslik}>📖 Günlük</Text><Text style={s.altyazi}>{gunluk.length} rüya</Text></View>
              <TouchableOpacity onPress={() => setProfilAcik(true)} style={s.profilIkon}><Text style={s.profilHarf}>{profilHarf}</Text></TouchableOpacity>
            </View>
            {gunlukYukleniyor ? <ActivityIndicator color="#6c47ff" style={{ marginTop: 40 }} />
              : gunluk.length === 0 ? <View style={s.bosKutu}><Text style={s.bosYazi}>Henüz rüya yok</Text><Text style={s.bosAlt}>İlk rüyanı yorumladığında burada görünecek</Text></View>
              : gunluk.map(kayit => (
                <TouchableOpacity key={kayit.id} style={s.gunlukKart} onPress={() => setDetayKayit(kayit)}>
                  <View style={s.gunlukKartUst}>
                    <View style={[s.miniBadge, { backgroundColor: duyguRenk[kayit.analiz.duygu] + '22' }]}>
                      <Text style={{ color: duyguRenk[kayit.analiz.duygu], fontSize: 11, fontWeight: 'bold' }}>{duyguEmoji[kayit.analiz.duygu]} {kayit.analiz.duygu}</Text>
                    </View>
                    <Text style={s.tarihYazi}>{tarihleriFormatla(kayit.tarih)}</Text>
                  </View>
                  <Text style={s.gunlukOzet} numberOfLines={2}>"{kayit.analiz.ozet}"</Text>
                  <Text style={s.gunlukRuya} numberOfLines={1}>{kayit.ruya}</Text>
                </TouchableOpacity>
              ))
            }
            <View style={{ height: 100 }} />
          </ScrollView>
        )}

        {/* İSTATİSTİK */}
        {aktifTab === 'istatistik' && (() => {
          const toplamRuya = gunluk.length;
          const duyguSayilari = gunluk.reduce((acc, k) => { acc[k.analiz.duygu] = (acc[k.analiz.duygu] || 0) + 1; return acc; }, {} as Record<string, number>);
          const enCokDuygu = Object.entries(duyguSayilari).sort((a, b) => b[1] - a[1])[0];
          const gorselliRuya = gunluk.filter(k => k.imageUrl).length;
          const buHafta = gunluk.filter(k => (Date.now() - new Date(k.tarih).getTime()) / 86400000 <= 7).length;
          return (
            <ScrollView style={s.container} contentContainerStyle={s.icerik}>
              <View style={s.anaHeader}>
                <View><Text style={s.baslik}>📊 İstatistik</Text><Text style={s.altyazi}>Rüya örüntülerini keşfet</Text></View>
                <TouchableOpacity onPress={() => setProfilAcik(true)} style={s.profilIkon}><Text style={s.profilHarf}>{profilHarf}</Text></TouchableOpacity>
              </View>
              {toplamRuya === 0
                ? <View style={s.bosKutu}><Text style={s.bosYazi}>Henüz veri yok</Text><Text style={s.bosAlt}>Rüya yorumladıkça istatistiklerin burada görünür</Text></View>
                : <>
                  <View style={s.istatKartlar}>
                    <View style={s.istatKart}><Text style={s.istatSayi}>{toplamRuya}</Text><Text style={s.istatLabel}>Toplam</Text></View>
                    <View style={s.istatKart}><Text style={s.istatSayi}>{buHafta}</Text><Text style={s.istatLabel}>Bu Hafta</Text></View>
                    <View style={s.istatKart}><Text style={s.istatSayi}>{gorselliRuya}</Text><Text style={s.istatLabel}>Görsel</Text></View>
                  </View>
                  {enCokDuygu && (
                    <View style={[s.enCokKart, { borderColor: duyguRenk[enCokDuygu[0] as DuyguTipi] + '44', backgroundColor: duyguRenk[enCokDuygu[0] as DuyguTipi] + '11' }]}>
                      <Text style={s.enCokBaslik}>EN ÇOK HİSSEDİLEN</Text>
                      <Text style={s.enCokEmoji}>{duyguEmoji[enCokDuygu[0] as DuyguTipi]}</Text>
                      <Text style={[s.enCokDuygu, { color: duyguRenk[enCokDuygu[0] as DuyguTipi] }]}>{enCokDuygu[0].toUpperCase()}</Text>
                      <Text style={s.enCokSayi}>{enCokDuygu[1]} rüyada</Text>
                    </View>
                  )}
                  <Text style={s.bolumBaslik}>Duygu Dağılımı</Text>
                  {Object.entries(duyguSayilari).sort((a, b) => b[1] - a[1]).map(([duygu, sayi]) => (
                    <View key={duygu} style={s.duyguSatir}>
                      <View style={s.duyguSatirSol}><Text style={s.duyguSatirEmoji}>{duyguEmoji[duygu as DuyguTipi]}</Text><Text style={s.duyguSatirIsim}>{duygu}</Text></View>
                      <View style={s.barContainer}><View style={[s.bar, { width: `${(sayi / toplamRuya) * 100}%` as any, backgroundColor: duyguRenk[duygu as DuyguTipi] }]} /></View>
                      <Text style={[s.duyguSatirSayi, { color: duyguRenk[duygu as DuyguTipi] }]}>{sayi}</Text>
                    </View>
                  ))}
                </>
              }
              <View style={{ height: 100 }} />
            </ScrollView>
          );
        })()}
      </View>

      {/* ALT MENÜ */}
      <View style={s.altMenu}>
        {([
          { id: 'ana', emoji: '🌙', label: 'Ana Sayfa' },
          { id: 'gunluk', emoji: '📖', label: 'Günlük' },
          { id: 'istatistik', emoji: '📊', label: 'İstatistik' },
        ] as { id: AnaEkran; emoji: string; label: string }[]).map(tab => (
          <TouchableOpacity key={tab.id} style={s.altMenuTab} onPress={() => { setAktifTab(tab.id); setYorumEkrani(false); setDetayKayit(null); }}>
            <Text style={[s.altMenuEmoji, aktifTab === tab.id && s.altMenuAktifEmoji]}>{tab.emoji}</Text>
            <Text style={[s.altMenuLabel, aktifTab === tab.id && s.altMenuAktifLabel]}>{tab.label}</Text>
          </TouchableOpacity>
        ))}
      </View>

      {/* PROFİL MODAL */}
      {profilAcik && (
        <View style={s.modalOverlay}>
          <Pressable style={{ flex: 1 }} onPress={() => setProfilAcik(false)} />
          <View style={s.profilModal}>
            <View style={s.profilModalIkon}><Text style={{ fontSize: 32 }}>{profilHarf}</Text></View>
            <Text style={s.profilAd}>{kullanici.displayName || 'Kullanıcı'}</Text>
            <Text style={s.profilEmail}>{kullanici.email}</Text>
            <View style={s.profilBilgi}>
              <View style={s.profilBilgiKart}><Text style={s.profilBilgiSayi}>{gunluk.length}</Text><Text style={s.profilBilgiLabel}>Rüya</Text></View>
              <View style={s.profilBilgiKart}><Text style={s.profilBilgiSayi}>{gunluk.filter(k => k.imageUrl).length}</Text><Text style={s.profilBilgiLabel}>Görsel</Text></View>
            </View>
            <TouchableOpacity style={s.cikisButon} onPress={cikisYap}><Text style={s.cikisYazi}>Çıkış Yap</Text></TouchableOpacity>
            <TouchableOpacity onPress={() => setProfilAcik(false)} style={{ marginTop: 12, padding: 12, alignItems: 'center' }}><Text style={{ color: '#555' }}>Kapat</Text></TouchableOpacity>
          </View>
        </View>
      )}
    </View>
  );
}

const s = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#0a0a1a' },
  icerik: { padding: 24, paddingTop: 64 },
  loadingEkran: { flex: 1, backgroundColor: '#0a0a1a', alignItems: 'center', justifyContent: 'center' },
  baslik: { color: '#fff', fontSize: 24, fontWeight: '800', marginBottom: 4, letterSpacing: -0.5 },
  altyazi: { color: '#666680', fontSize: 13, marginBottom: 24 },
  anaHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 8 },
  profilIkon: { width: 44, height: 44, borderRadius: 22, backgroundColor: '#6c47ff', alignItems: 'center', justifyContent: 'center', shadowColor: '#6c47ff', shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.5, shadowRadius: 12, elevation: 8 },
  profilHarf: { color: '#fff', fontSize: 18, fontWeight: '800' },
  inputKart: { backgroundColor: '#0f0f28', borderRadius: 24, padding: 20, borderWidth: 1, borderColor: '#1e1e40', marginBottom: 16, shadowColor: '#6c47ff', shadowOffset: { width: 0, height: 0 }, shadowOpacity: 0.06, shadowRadius: 20, elevation: 4 },
  inputLabel: { color: '#555570', fontSize: 10, letterSpacing: 2, marginBottom: 12 },
  input: { color: '#e0e0f0', fontSize: 15, lineHeight: 26, minHeight: 130, textAlignVertical: 'top' },
  inputAlt: { flexDirection: 'row', justifyContent: 'space-between', marginTop: 12, paddingTop: 12, borderTopWidth: 1, borderTopColor: '#0f0f28' },
  ipucu: { color: '#555570', fontSize: 12 },
  sayac: { color: '#555570', fontSize: 12 },
  buton: { backgroundColor: '#6c47ff', borderRadius: 20, padding: 18, alignItems: 'center', marginBottom: 32, shadowColor: '#6c47ff', shadowOffset: { width: 0, height: 12 }, shadowOpacity: 0.5, shadowRadius: 24, elevation: 10 },
  butonDevre: { backgroundColor: '#0d0d20', shadowOpacity: 0 },
  butonYazi: { color: '#fff', fontWeight: '700', fontSize: 16, letterSpacing: 0.5 },
  yukleniyorSatir: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  bolumBaslik: { color: '#ffffff', fontSize: 11, fontWeight: '700', marginBottom: 14, marginTop: 8, letterSpacing: 2, opacity: 0.3 },
  bolumKutu: { backgroundColor: '#0f0f28', borderRadius: 18, padding: 18, borderWidth: 1, borderColor: '#1e1e40', marginBottom: 24 },
  gunlukKart: { backgroundColor: '#0f0f28', borderRadius: 20, padding: 18, marginBottom: 12, borderWidth: 1, borderColor: '#1e1e40' },
  gunlukKartUst: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 },
  miniBadge: { paddingHorizontal: 10, paddingVertical: 5, borderRadius: 20 },
  tarihYazi: { color: '#555570', fontSize: 11 },
  gunlukOzet: { color: '#777799', fontStyle: 'italic', fontSize: 13, lineHeight: 22, marginBottom: 4 },
  gunlukRuya: { color: '#666680', fontSize: 12 },
  tumunuGor: { alignItems: 'center', padding: 12 },
  tumunuGorYazi: { color: '#6c47ff', fontSize: 14 },
  geriButon: { marginBottom: 24 },
  geriYazi: { color: '#6c47ff', fontSize: 14 },
  duyguKart: { flexDirection: 'row', alignItems: 'center', gap: 10, alignSelf: 'flex-start', paddingHorizontal: 16, paddingVertical: 10, borderRadius: 30, borderWidth: 1, marginBottom: 18 },
  duyguEmoji: { fontSize: 18 },
  duyguYazi: { fontWeight: '800', fontSize: 13, letterSpacing: 1.5 },
  ozet: { color: '#8888aa', fontStyle: 'italic', fontSize: 15, lineHeight: 26, marginBottom: 6, borderLeftWidth: 2, borderLeftColor: '#6c47ff', paddingLeft: 16, paddingVertical: 4 },
  kaydedildiYazi: { color: '#1a4a2a', fontSize: 11, marginBottom: 28, paddingLeft: 16, letterSpacing: 0.5 },
  yorumYazi: { color: '#bbbbdd', fontSize: 14, lineHeight: 28 },
  sembolKart: { flexDirection: 'row', backgroundColor: '#060612', borderRadius: 16, padding: 14, marginBottom: 10, borderWidth: 1, borderColor: '#0f0f28', gap: 14 },
  sembolNo: { width: 34, height: 34, borderRadius: 10, backgroundColor: '#1a0f3a', alignItems: 'center', justifyContent: 'center' },
  sembolNoYazi: { color: '#6c47ff', fontWeight: '800', fontSize: 13 },
  sembolIsim: { color: '#ffffff', fontWeight: '700', fontSize: 14, marginBottom: 5 },
  sembolAnlam: { color: '#666688', fontSize: 13, lineHeight: 20 },
  gorselButon: { marginTop: 12, marginBottom: 12, borderRadius: 18, padding: 16, alignItems: 'center', backgroundColor: '#1a0f3a', borderWidth: 1, borderColor: '#4a2aaa' },
  gorselButonYazi: { color: '#a070ff', fontSize: 14, fontWeight: '700' },
  yeniButon: { marginTop: 8, padding: 14, borderRadius: 18, borderWidth: 1, borderColor: '#1e1e40', alignItems: 'center' },
  yeniButonYazi: { color: '#555577', fontSize: 14 },
  modalOverlay: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, zIndex: 999 },
  modalArka: { flex: 1, backgroundColor: 'rgba(0,0,0,0.92)', justifyContent: 'center', padding: 20 },
  modalKart: { backgroundColor: '#06060f', borderRadius: 28, padding: 20, maxHeight: '90%', borderWidth: 1, borderColor: '#1e1e40', shadowColor: '#6c47ff', shadowOffset: { width: 0, height: 0 }, shadowOpacity: 0.15, shadowRadius: 40, elevation: 20 },
  modalBaslik: { color: '#fff', fontSize: 20, fontWeight: '800', marginBottom: 18 },
  modalYukleniyor: { paddingVertical: 50, alignItems: 'center', gap: 16 },
  modalYazi: { color: '#555577', textAlign: 'center', fontSize: 14 },
  hataKutu: { backgroundColor: '#0f0404', borderRadius: 14, padding: 16, marginBottom: 16, borderWidth: 1, borderColor: '#3a1010' },
  hataYazi: { color: '#8a4444', fontSize: 13, lineHeight: 20 },
  gorsel: { width: '100%', height: 400, borderRadius: 20, backgroundColor: '#0a0a1a' },
  paylasButon: { marginTop: 14, backgroundColor: '#0f0f28', borderRadius: 16, padding: 14, alignItems: 'center', borderWidth: 1, borderColor: '#2a1a6a' },
  paylasYazi: { color: '#8a60ff', fontWeight: '700', fontSize: 15 },
  kapatButon: { marginTop: 12, padding: 14, borderRadius: 16, borderWidth: 1, borderColor: '#1e1e40', alignItems: 'center' },
  kapatButonYazi: { color: '#555577', fontWeight: '600' },
  bosKutu: { alignItems: 'center', paddingVertical: 80, gap: 10 },
  bosYazi: { color: '#555570', fontSize: 18, fontWeight: '600' },
  bosAlt: { color: '#1a1a3a', fontSize: 13, textAlign: 'center', lineHeight: 22 },
  detayHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 },
  tarihBuyuk: { color: '#555570', fontSize: 13, marginBottom: 20, letterSpacing: 0.5 },
  silYazi: { color: '#5a2a2a', fontSize: 14 },
  detayGorsel: { width: '100%', height: 280, borderRadius: 20, marginBottom: 24, backgroundColor: '#0a0a1a' },
  onboardingContainer: { flex: 1, justifyContent: 'space-between', paddingTop: 64, paddingBottom: 52, paddingHorizontal: 28 },
  atlaButon: { alignSelf: 'flex-end' },
  atlaYazi: { color: '#555570', fontSize: 14 },
  onboardingIcerik: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 20 },
  onboardingEmoji: { fontSize: 88 },
  onboardingBaslik: { color: '#fff', fontSize: 28, fontWeight: '800', textAlign: 'center', letterSpacing: -0.5 },
  onboardingAciklama: { color: '#555577', fontSize: 16, textAlign: 'center', lineHeight: 28 },
  onboardingAlt: { gap: 28 },
  noktalar: { flexDirection: 'row', justifyContent: 'center', gap: 8 },
  nokta: { width: 6, height: 6, borderRadius: 3, backgroundColor: '#1a1a3a' },
  noktaAktif: { width: 28, height: 6, borderRadius: 3, backgroundColor: '#6c47ff' },
  ileriButon: { backgroundColor: '#6c47ff', borderRadius: 20, padding: 18, alignItems: 'center', shadowColor: '#6c47ff', shadowOffset: { width: 0, height: 10 }, shadowOpacity: 0.5, shadowRadius: 20, elevation: 10 },
  ileriYazi: { color: '#fff', fontWeight: '800', fontSize: 16 },
  authTab: { flexDirection: 'row', backgroundColor: '#0f0f28', borderRadius: 16, padding: 4, marginBottom: 28 },
  authTabButon: { flex: 1, padding: 13, alignItems: 'center', borderRadius: 13 },
  authTabAktif: { backgroundColor: '#6c47ff' },
  authTabYazi: { color: '#555570', fontWeight: '700', fontSize: 14 },
  authTabYaziAktif: { color: '#fff' },
  authInput: { backgroundColor: '#0f0f28', borderRadius: 16, padding: 16, color: '#c0c0e0', fontSize: 15, borderWidth: 1, borderColor: '#1e1e40' },
  altMenu: { flexDirection: 'row', backgroundColor: '#020208', borderTopWidth: 1, borderTopColor: '#0d0d20', paddingBottom: 24, paddingTop: 14, shadowColor: '#000', shadowOffset: { width: 0, height: -8 }, shadowOpacity: 0.6, shadowRadius: 16, elevation: 20 },
  altMenuTab: { flex: 1, alignItems: 'center', gap: 5 },
  altMenuEmoji: { fontSize: 22, opacity: 0.2 },
  altMenuAktifEmoji: { opacity: 1 },
  altMenuLabel: { color: '#1a1a3a', fontSize: 10, letterSpacing: 0.5 },
  altMenuAktifLabel: { color: '#6c47ff', fontWeight: '700', fontSize: 10 },
  profilModal: { backgroundColor: '#06060f', borderTopLeftRadius: 32, borderTopRightRadius: 32, padding: 28, paddingBottom: 44, borderTopWidth: 1, borderTopColor: '#1e1e40' },
  profilModalIkon: { width: 80, height: 80, borderRadius: 40, backgroundColor: '#1a0f3a', alignItems: 'center', justifyContent: 'center', alignSelf: 'center', marginBottom: 16, borderWidth: 2, borderColor: '#6c47ff', shadowColor: '#6c47ff', shadowOffset: { width: 0, height: 0 }, shadowOpacity: 0.4, shadowRadius: 20, elevation: 10 },
  profilAd: { color: '#fff', fontSize: 20, fontWeight: '800', textAlign: 'center', marginBottom: 4 },
  profilEmail: { color: '#555570', fontSize: 14, textAlign: 'center', marginBottom: 28 },
  profilBilgi: { flexDirection: 'row', gap: 12, marginBottom: 28 },
  profilBilgiKart: { flex: 1, backgroundColor: '#0a0a1a', borderRadius: 18, padding: 16, alignItems: 'center', borderWidth: 1, borderColor: '#1e1e40' },
  profilBilgiSayi: { color: '#fff', fontSize: 26, fontWeight: '800', marginBottom: 4 },
  profilBilgiLabel: { color: '#555570', fontSize: 12 },
  cikisButon: { backgroundColor: '#080404', borderRadius: 16, padding: 16, alignItems: 'center', borderWidth: 1, borderColor: '#3a1010' },
  cikisYazi: { color: '#6a2a2a', fontWeight: '700', fontSize: 15 },
  istatKartlar: { flexDirection: 'row', gap: 12, marginBottom: 28 },
  istatKart: { flex: 1, backgroundColor: '#0f0f28', borderRadius: 18, padding: 16, alignItems: 'center', borderWidth: 1, borderColor: '#1e1e40' },
  istatSayi: { color: '#fff', fontSize: 30, fontWeight: '800', marginBottom: 6 },
  istatLabel: { color: '#555570', fontSize: 11, letterSpacing: 0.5 },
  enCokKart: { borderRadius: 24, borderWidth: 1, padding: 28, alignItems: 'center', marginBottom: 28 },
  enCokBaslik: { color: '#555570', fontSize: 10, letterSpacing: 2, marginBottom: 14 },
  enCokEmoji: { fontSize: 44, marginBottom: 10 },
  enCokDuygu: { fontSize: 22, fontWeight: '800', marginBottom: 6, letterSpacing: 1 },
  enCokSayi: { color: '#555570', fontSize: 13 },
  duyguSatir: { flexDirection: 'row', alignItems: 'center', marginBottom: 14, gap: 10 },
  duyguSatirSol: { flexDirection: 'row', alignItems: 'center', gap: 8, width: 110 },
  duyguSatirEmoji: { fontSize: 16 },
  duyguSatirIsim: { color: '#777799', fontSize: 13 },
  barContainer: { flex: 1, height: 6, backgroundColor: '#0d0d20', borderRadius: 3, overflow: 'hidden' },
  bar: { height: 6, borderRadius: 3 },
  duyguSatirSayi: { width: 24, textAlign: 'right', fontSize: 13, fontWeight: '800' },
});
