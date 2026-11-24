# 🚗 Turbo.az → Telegram bildiriş botu

turbo.az-da seçdiyin **istənilən filtrlərə** (marka, model, qiymət, il, yürüş, şəhər, ban növü, rəng, sürətlər qutusu, yanacaq, barter, kredit və s.) uyğun **yeni elan yerləşdirilən kimi** Telegram-a şəkilli bildiriş göndərir.

## Necə işləyir?
1. turbo.az saytında filtrləri seçib **"Elanları göstər"** düyməsini basırsan.
2. Brauzerin ünvan sətrindəki linki kopyalayıb bota göndərirsən.
3. Bot bu axtarışı hər ~60 saniyədən bir yoxlayır, yeni elan çıxanda şəkil, qiymət, il, yürüş və elanın linki ilə sənə yazır.

Saytdakı bütün filtrlər linkin içində olduğu üçün bot **hamısını eyni anda** nəzərə alır. İstədiyin qədər ayrı-ayrı filtr əlavə edə bilərsən.

> Telefonda turbo.az **tətbiqindən** yox, **brauzerdən** (Chrome/Safari) istifadə et, çünki link orada görünür.

---

## 1-ci addım: Telegram-da bot yarat (2 dəqiqəlik iş)
1. Telegram-da **@BotFather** hesabını tap (yanında mavi təsdiq nişanı olan) və **Start** bas.
2. `/newbot` yaz.
3. Bota ad ver, məsələn: `Turbo Bildiriş`.
4. Username ver. Sonu `bot` ilə bitməlidir, məsələn: `elvin_turbo_bot`.
5. BotFather sənə belə bir **token** verəcək: `7234567890:AAH...xyz`. Onu kopyala.

> ⚠️ Tokeni heç kimə göstərmə. Tokeni bilən hər kəs botu idarə edə bilər. Əgər yayılsa, BotFather-da `/revoke` ilə yenisini al.

## 2-ci addım: Botu kompüterində işə sal (Windows)
Kompüterində **Node.js 20.12 və ya daha yeni** versiya olmalıdır (bu kompüterdə v22 artıq var). Başqa kompüterdə işlədəcəksənsə, https://nodejs.org saytından LTS versiyasını yüklə.

1. Bu qovluqda **`start.bat`** faylına iki dəfə klik et.
2. İlk dəfə Notepad-da `.env` faylı açılacaq. `BOT_TOKEN=` sətrinə tokenini yaz, yadda saxla və bağla.
3. `start.bat` faylını yenidən aç. Ekranda `✅ Bot işə düşdü: @...` yazısını görəcəksən.
4. Telegram-da botunu tap və **/start** yaz. Bunu ilk yazan şəxs botun **sahibi** olur və başqaları botdan istifadə edə bilmir.
5. turbo.az-dan axtarış linkini bota göndər. Bundan sonra bildirişlər gəlməyə başlayacaq.

Komanda sətrindən işə salmaq istəsən: `npm install`, sonra `npm start`.

> Bot yalnız kompüter **açıq və internetə qoşulu** olanda işləyir. Kompüter yandırılanda avtomatik açılması üçün: `Win + R` bas, `shell:startup` yaz, açılan qovluğa `start.bat` faylının qısayolunu (shortcut) qoy.

## 3-cü addım (tövsiyə olunur): 24/7 işləməsi üçün pulsuz serverə yerləşdir

### Variant A: Tam pulsuz və bank kartı olmadan — Render.com + cron-job.org (5 dəqiqə)
Layihədə `render.yaml`, `/health` endpointi və GitHub Gist bulud yaddaşı hazır qurulub:
1. Bu qovluğu **GitHub**-da yeni (Private və ya Public) repozitoriyaya yüklə (`.gitignore` sayəsində `.env` və `data/` yüklənməyəcək).
2. Filtrlərin server yenilənəndə silinməməsi üçün GitHub-da **Settings → Developer settings → Personal access tokens → Tokens (classic)** bölməsindən yalnız **`gist`** icazəsi olan bir token yarat (`ghp_...`).
3. [render.com](https://render.com) saytında GitHub ilə qeydiyyatdan keç → **New + → Blueprint** (və ya **Web Service**) seçib repozitoriyanı qoş, **Free** planı seç.
4. **Environment** bölməsində bu dəyişənləri yaz:
   - `BOT_TOKEN` = BotFather tokenin
   - `ALLOWED_USER_IDS` = Telegram ID-n (`/myid` ilə baxa bilərsən)
   - `GITHUB_TOKEN` = 2-ci addımdakı GitHub tokenin (filtrləri gizli Gist-də saxlayır)
5. Deploy bitdikdən sonra Render sənə `https://turboaz-bot-xxxx.onrender.com` kimi link verəcək. Render pulsuz planda 15 dəqiqə sorğu gəlməsə yuxuya getdiyi üçün [cron-job.org](https://cron-job.org) saytında pulsuz hesab aç və `https://turboaz-bot-xxxx.onrender.com/health` ünvanına **hər 10 dəqiqədən bir** sorğu göndərən cron yarat.

### Variant B: Əsl 24/7 Linux VPS — Google Cloud (`e2-micro`) / Oracle Cloud (Always Free) / Ucuz VPS
Bank kartı ilə qeydiyyatdan keçə bilirsənsə, **Oracle Cloud Always Free** və ya **Google Cloud `e2-micro`** (`us-central1`, 30 GB Standard Disk) ömürlük pulsuz Linux VPS verir (və ya ayda 4–6 $ Hetzner / Contabo / yerli VPS).

**Ubuntu serverdə Docker ilə qurmaq:**
```bash
# 1) Docker-i quraşdır
curl -fsSL https://get.docker.com | sh

# 2) Bot qovluğunu serverə köçür (öz kompüterindən, PowerShell-də):
#    scp -r C:\Users\HP\.gemini\antigravity\scratch\turboaz-bot root@SERVER_IP:/opt/
#    (node_modules və data qovluqlarını köçürməyə ehtiyac yoxdur)

# 3) Serverdə:
cd /opt/turboaz-bot
cp .env.example .env && nano .env      # BOT_TOKEN yaz
docker compose up -d --build           # işə sal (server yenidən başlasa da avtomatik qalxır)
docker compose logs -f                 # loqlara bax
```

**Docker olmadan (pm2 ilə):**
```bash
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash - && sudo apt install -y nodejs
cd /opt/turboaz-bot && npm install && cp .env.example .env && nano .env
sudo npm i -g pm2 && pm2 start src/index.js --name turbo-bot && pm2 save && pm2 startup
```

> ⚠️ **Eyni tokenlə botu iki yerdə birdən işlətmə.** Serverə keçəndə kompüterdəki botu bağla. Filtrlərin `data/db.json` faylında saxlanılır. Onları itirmək istəmirsənsə, bu faylı da serverə köçür.

> Əgər serverdə loqda `turbo.az HTTP 403` görsən, turbo.az həmin xarici serverin IP ünvanını bloklayır deməkdir. Bu halda Azərbaycanda yerləşən VPS götür və ya botu evdəki kompüterdə işlət.

---

## Bot əmrləri
| Əmr | Nə edir |
|---|---|
| *(link göndər)* | Yeni filtr əlavə edir. Linkdən sonra ad da yaza bilərsən: `link Ucuz Prius` |
| `/list` | Filtrləri göstərir: ⏸ dayandır, 👁 son elan, 🗑 sil |
| `/rename 2 Yeni ad` | Filtrin adını dəyişir |
| `/pause 2`, `/resume 2`, `/delete 2` | Filtri dayandırır, davam etdirir və ya silir |
| `/check` | Gözləmədən dərhal yoxlayır |
| `/status` | Botun vəziyyətini göstərir |
| `/myid` | Telegram ID-ni göstərir |

## Ayarlar (`.env`)
| Dəyişən | Standart | İzah |
|---|---|---|
| `BOT_TOKEN` | — | BotFather-dan alınan token (məcburidir) |
| `ALLOWED_USER_IDS` | boş | Botdan istifadə edə bilən ID-lər, vergüllə ayrılır (məs. ailə üzvləri). Boş qalsa, ilk `/start` yazan sahib olur |
| `CHECK_INTERVAL_SEC` | `60` | Neçə saniyədən bir yoxlanılsın (minimum 30) |
| `NEW_ONLY` | `true` | `true` olanda yalnız yeni yerləşdirilən elanlar gəlir. `false` olanda **irəli çəkilən** köhnə elanlar da gəlir |

## Texniki qeydlər
- Bot ilk dəfə filtr əlavə ediləndə səhifədəki mövcud elanları "görülmüş" kimi qeyd edir. Ona görə yalnız **bundan sonra** çıxan elanlar göndərilir.
- Yeni elanı köhnə, amma irəli çəkilmiş elandan elan ID-sinə baxaraq ayırır (yeni elanların ID-si həmişə daha böyük olur).
- Saytı yükləməmək üçün sorğuların arasında fasilə verir. turbo.az əlçatmaz olanda yoxlamaları seyrəldir və sənə xəbərdarlıq göndərir.
- Telegram olmadan sınamaq üçün: `npm run try -- "https://turbo.az/autos?..."` (səhifədən oxunan elanları göstərir), `npm test` isə parser testlərini işə salır.
- turbo.az sayt quruluşunu dəyişsə, `src/turbo.js` faylındakı `parseListings` funksiyasını yeniləmək lazım ola bilər.
