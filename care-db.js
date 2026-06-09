// PlantApp — wbudowana baza pielęgnacji popularnych roślin domowych.
// Klucz = rodzaj (genus) łaciński, małymi literami. Dopasowanie po wyniku z Pl@ntNet.
// waterSummer / waterWinter = co ile dni podlewać (orientacyjnie, korygowane palcem w ziemi!).

var CARE_DB = {
  "monstera": { pl: "Monstera", waterSummer: 7, waterWinter: 12, light: "Jasne, rozproszone światło. Znosi półcień.", humidity: "Lubi wyższą wilgotność (60%+). Zraszaj lub myj liście.", toxic: true, tips: "Podlewaj gdy 3–4 cm ziemi przeschnie. Daj podporę (palik kokosowy). Żółte liście = zwykle przelanie." },
  "epipremnum": { pl: "Epipremnum (scindapsus złocisty)", waterSummer: 8, waterWinter: 14, light: "Od półcienia po jasne rozproszone. Im jaśniej, tym ładniejsze przebarwienia.", humidity: "Niewymagający.", toxic: true, tips: "Prawie niezniszczalny. Podlewaj po przeschnięciu wierzchniej warstwy. Łatwo się ukorzenia w wodzie." },
  "scindapsus": { pl: "Scindapsus", waterSummer: 8, waterWinter: 14, light: "Jasne rozproszone światło.", humidity: "Średnia.", toxic: true, tips: "Zwisające liście = chce wody. Nie przelewaj — korzenie łatwo gniją." },
  "ficus": { pl: "Fikus", waterSummer: 7, waterWinter: 12, light: "Dużo jasnego, rozproszonego światła. Benjamin zrzuca liście przy przestawianiu.", humidity: "Średnia. Przecieraj liście z kurzu.", toxic: true, tips: "Nie przestawiaj bez potrzeby. Podlewaj umiarkowanie — zalanie kończy się zrzucaniem liści." },
  "sansevieria": { pl: "Sansewieria (wężownica)", waterSummer: 14, waterWinter: 25, light: "Od cienia po pełne słońce — wszystko zniesie.", humidity: "Niska — sucha łazienka czy kaloryfer jej nie ruszy.", toxic: true, tips: "Lepiej nie podlać niż przelać. Zimą podlewaj rzadko. Gnijąca nasada = za dużo wody." },
  "dracaena": { pl: "Dracena", waterSummer: 8, waterWinter: 14, light: "Jasne rozproszone. Pstrokate odmiany potrzebują więcej światła.", humidity: "Średnia. Brązowe końcówki = za sucho lub chlor w wodzie.", toxic: true, tips: "Podlewaj odstaną wodą. Wrażliwa na fluor i przelanie." },
  "zamioculcas": { pl: "Zamiokulkas", waterSummer: 14, waterWinter: 24, light: "Toleruje cień, najlepiej jasne rozproszone.", humidity: "Bez wymagań.", toxic: true, tips: "Magazynuje wodę w bulwach — podlewaj dopiero gdy ziemia całkiem wyschnie. Żółknące liście = przelanie." },
  "spathiphyllum": { pl: "Skrzydłokwiat", waterSummer: 5, waterWinter: 8, light: "Półcień do jasnego rozproszonego. Bez ostrego słońca.", humidity: "Wysoka — zraszaj.", toxic: true, tips: "Teatralnie opuszcza liście gdy chce pić — i szybko wstaje po podlaniu. Nie dopuszczaj do tego regularnie." },
  "chlorophytum": { pl: "Zielistka", waterSummer: 6, waterWinter: 10, light: "Jasne rozproszone, znosi półcień.", humidity: "Średnia.", toxic: false, tips: "Bezpieczna dla zwierząt. Brązowe końcówki = sucha gleba lub twarda woda. Łatwo rozmnażać z odrostów." },
  "calathea": { pl: "Kalatea", waterSummer: 5, waterWinter: 8, light: "Półcień, rozproszone światło. Słońce pali liście.", humidity: "Bardzo wysoka (70%+). Nawilżacz mile widziany.", toxic: false, tips: "Diwa wśród roślin. Podlewaj przegotowaną/filtrowaną wodą. Zwijające się liście = za sucho." },
  "maranta": { pl: "Maranta", waterSummer: 5, waterWinter: 9, light: "Półcień, bez bezpośredniego słońca.", humidity: "Wysoka.", toxic: false, tips: "Liście składają się na noc — to normalne. Miękka woda, stale lekko wilgotna ziemia." },
  "philodendron": { pl: "Filodendron", waterSummer: 7, waterWinter: 12, light: "Jasne rozproszone do półcienia.", humidity: "Lubi wyższą.", toxic: true, tips: "Podlewaj po przeschnięciu 2–3 cm. Pnące odmiany doceniają podporę." },
  "anthurium": { pl: "Anturium", waterSummer: 6, waterWinter: 10, light: "Jasne rozproszone światło.", humidity: "Wysoka.", toxic: true, tips: "Lekko wilgotna ziemia, nigdy mokra. Brak kwiatów = zwykle za ciemno." },
  "aloe": { pl: "Aloes", waterSummer: 12, waterWinter: 25, light: "Pełne słońce lub bardzo jasno.", humidity: "Niska.", toxic: true, tips: "Sukulent — podlewaj obficie ale rzadko, po pełnym wyschnięciu ziemi. Miękkie, przezroczyste liście = przelanie." },
  "crassula": { pl: "Grubosz (drzewko szczęścia)", waterSummer: 12, waterWinter: 25, light: "Dużo słońca.", humidity: "Niska.", toxic: true, tips: "Pomarszczone liście = czas podlać. Zimą chłodniej i prawie sucho." },
  "echeveria": { pl: "Eszeweria", waterSummer: 12, waterWinter: 28, light: "Pełne słońce.", humidity: "Niska.", toxic: false, tips: "Podlewaj omijając rozetę — woda w środku = gnicie. Przeciągnięta, wyciągnięta forma = za mało światła." },
  "haworthia": { pl: "Haworsja", waterSummer: 14, waterWinter: 28, light: "Jasno, ale znosi mniej słońca niż inne sukulenty.", humidity: "Niska.", toxic: false, tips: "Bezpieczna dla zwierząt. Podlewaj rzadko, ziemia przepuszczalna." },
  "kalanchoe": { pl: "Kalanchoe (żyworódka)", waterSummer: 10, waterWinter: 18, light: "Dużo światła, trochę słońca.", humidity: "Niska.", toxic: true, tips: "Po przekwitnięciu przytnij. Krótki dzień stymuluje kwitnienie." },
  "orchidaceae": { pl: "Storczyk", waterSummer: 7, waterWinter: 10, light: "Jasne rozproszone, bez ostrego słońca.", humidity: "Wysoka.", toxic: false, tips: "Podlewaj przez zanurzenie doniczki na 15 min, potem dobrze odsącz. Korzenie zielone = OK, srebrne = czas podlać." },
  "phalaenopsis": { pl: "Falenopsis (storczyk)", waterSummer: 7, waterWinter: 10, light: "Jasne rozproszone światło, np. parapet wschodni.", humidity: "Wysoka.", toxic: false, tips: "Przezroczysta doniczka pomaga ocenić korzenie. Po kwitnieniu przytnij pęd nad 2–3 oczkiem." },
  "hedera": { pl: "Bluszcz", waterSummer: 6, waterWinter: 10, light: "Półcień do jasnego. Odmiany pstre potrzebują więcej światła.", humidity: "Średnia/wysoka — w suchym powietrzu łapie przędziorki.", toxic: true, tips: "Lubi chłód. Regularnie sprawdzaj spód liści pod kątem przędziorka." },
  "pelargonium": { pl: "Pelargonia", waterSummer: 4, waterWinter: 10, light: "Pełne słońce.", humidity: "Niska.", toxic: true, tips: "Usuwaj przekwitnięte kwiaty. Zimą chłodno i oszczędnie z wodą." },
  "begonia": { pl: "Begonia", waterSummer: 5, waterWinter: 9, light: "Jasne rozproszone.", humidity: "Wysoka, ale nie zraszaj liści (plamy, mączniak).", toxic: true, tips: "Podlewaj od dołu. Wrażliwa na zalanie i mączniaka." },
  "tradescantia": { pl: "Trzykrotka", waterSummer: 6, waterWinter: 10, light: "Jasno — wtedy ma intensywne kolory.", humidity: "Średnia.", toxic: true, tips: "Szybko rośnie i łysieje od dołu — regularnie przycinaj i wsadzaj sadzonki z powrotem." },
  "peperomia": { pl: "Peperomia", waterSummer: 9, waterWinter: 15, light: "Jasne rozproszone.", humidity: "Średnia.", toxic: false, tips: "Bezpieczna dla zwierząt. Mięsiste liście magazynują wodę — nie przelewaj." },
  "pilea": { pl: "Pilea (pieniążek)", waterSummer: 7, waterWinter: 12, light: "Jasne rozproszone, obracaj doniczkę dla równego wzrostu.", humidity: "Średnia.", toxic: false, tips: "Produkuje odrosty — łatwy prezent dla znajomych. Opadające liście = sprawdź podlewanie." },
  "hoya": { pl: "Hoja (woskownica)", waterSummer: 9, waterWinter: 16, light: "Dużo jasnego światła, trochę słońca.", humidity: "Średnia.", toxic: false, tips: "Nie ścinaj pędów po kwitnieniu — kwitnie z tych samych szypułek. Lubi być lekko ciasno w doniczce." },
  "yucca": { pl: "Juka", waterSummer: 9, waterWinter: 18, light: "Pełne słońce.", humidity: "Niska.", toxic: true, tips: "Wytrzymała. Przelanie to jedyny prosty sposób, żeby ją zabić." },
  "schefflera": { pl: "Szeflera", waterSummer: 8, waterWinter: 13, light: "Jasne rozproszone.", humidity: "Średnia.", toxic: true, tips: "Zrzuca liście przy zalaniu i przeciągach. Lepkie liście = sprawdź czy nie ma tarczników." },
  "fittonia": { pl: "Fitonia", waterSummer: 4, waterWinter: 7, light: "Półcień, rozproszone światło.", humidity: "Bardzo wysoka — idealna do terrarium/łazienki.", toxic: false, tips: "Mdleje spektakularnie gdy sucho i równie szybko się podnosi. Nie dopuszczaj do pełnego przesuszenia." },
  "asparagus": { pl: "Asparagus", waterSummer: 6, waterWinter: 10, light: "Jasne rozproszone.", humidity: "Średnia/wysoka.", toxic: true, tips: "Żółknące 'igiełki' = za sucho lub za ciemno." },
  "nephrolepis": { pl: "Nefrolepis (paproć)", waterSummer: 4, waterWinter: 7, light: "Półcień, bez słońca.", humidity: "Wysoka — zraszaj często.", toxic: false, tips: "Ziemia stale lekko wilgotna. Suche powietrze = brązowiejące listki." },
  "chamaedorea": { pl: "Chamedora (palma koralowa)", waterSummer: 7, waterWinter: 11, light: "Półcień do jasnego rozproszonego.", humidity: "Średnia/wysoka.", toxic: false, tips: "Bezpieczna dla zwierząt. Wrażliwa na przędziorki w suchym powietrzu." },
  "dypsis": { pl: "Areka (palma)", waterSummer: 6, waterWinter: 10, light: "Jasno, bez ostrego południowego słońca.", humidity: "Wysoka.", toxic: false, tips: "Podlewaj miękką wodą. Brązowe końcówki = suche powietrze." },
  "dieffenbachia": { pl: "Difenbachia", waterSummer: 7, waterWinter: 12, light: "Jasne rozproszone.", humidity: "Średnia/wysoka.", toxic: true, tips: "Sok mocno drażniący — uważaj przy przycinaniu, trzymaj z dala od dzieci i zwierząt." },
  "aglaonema": { pl: "Aglaonema", waterSummer: 8, waterWinter: 13, light: "Półcień — jedna z najlepszych roślin do ciemniejszych kątów.", humidity: "Średnia.", toxic: true, tips: "Nie lubi zimna (<16°C) i przeciągów." },
  "syngonium": { pl: "Syngonium", waterSummer: 7, waterWinter: 11, light: "Jasne rozproszone do półcienia.", humidity: "Średnia/wysoka.", toxic: true, tips: "Szybko rośnie. Przycinanie zagęszcza." },
  "alocasia": { pl: "Alokazja", waterSummer: 5, waterWinter: 9, light: "Jasne rozproszone.", humidity: "Wysoka.", toxic: true, tips: "Wymagająca: ciepło, wilgotno, równomierne podlewanie. Może zrzucić liście zimą i odbić wiosną." },
  "strelitzia": { pl: "Strelicja", waterSummer: 6, waterWinter: 11, light: "Pełne słońce / bardzo jasno.", humidity: "Średnia.", toxic: true, tips: "Pęknięcia blaszki liściowej są naturalne. Kwitnie dopiero po kilku latach." },
  "citrus": { pl: "Cytrus", waterSummer: 5, waterWinter: 10, light: "Maksimum słońca.", humidity: "Średnia.", toxic: false, tips: "Latem może stać na balkonie. Żółknięcie między nerwami = niedobór żelaza (chelat pomoże)." },
  "coffea": { pl: "Kawowiec", waterSummer: 5, waterWinter: 9, light: "Jasne rozproszone.", humidity: "Wysoka.", toxic: true, tips: "Nie przesuszaj — szybko obwisa. Lubi lekko kwaśną ziemię." },
  "euphorbia": { pl: "Wilczomlecz", waterSummer: 12, waterWinter: 24, light: "Dużo słońca.", humidity: "Niska.", toxic: true, tips: "Biały sok mocno drażniący! Traktuj jak sukulenta — rzadkie podlewanie." },
  "cactaceae": { pl: "Kaktus", waterSummer: 12, waterWinter: 30, light: "Pełne słońce.", humidity: "Niska.", toxic: false, tips: "Zimą niemal nie podlewaj (chłodne stanowisko = spoczynek). Podlewanie zimą w cieple = wyciąganie i gnicie." },
  "opuntia": { pl: "Opuncja", waterSummer: 12, waterWinter: 30, light: "Pełne słońce.", humidity: "Niska.", toxic: false, tips: "Glochidy (mikro-kolce) wbijają się w skórę — przesadzaj w grubych rękawicach." },
  "musa": { pl: "Bananowiec", waterSummer: 4, waterWinter: 8, light: "Bardzo jasno, dużo słońca.", humidity: "Wysoka.", toxic: false, tips: "Pije ogromne ilości wody latem. Postrzępione liście to u bananowca norma." },
  "stephanotis": { pl: "Stefanotis", waterSummer: 6, waterWinter: 11, light: "Jasno, bez ostrego słońca.", humidity: "Średnia/wysoka.", toxic: false, tips: "Nie obracaj i nie przestawiaj gdy ma pąki — zrzuci je." },
  "gardenia": { pl: "Gardenia", waterSummer: 5, waterWinter: 9, light: "Jasno, lekkie słońce rano.", humidity: "Wysoka.", toxic: true, tips: "Kapryśna: miękka woda, kwaśna ziemia, stała temperatura. Zrzuca pąki przy każdej zmianie." },
  "hibiscus": { pl: "Hibiskus (ketmia)", waterSummer: 4, waterWinter: 9, light: "Pełne słońce.", humidity: "Średnia.", toxic: false, tips: "Głodomór — nawóź regularnie w sezonie. Zrzuca pąki przy przesuszeniu." },
  "lavandula": { pl: "Lawenda", waterSummer: 5, waterWinter: 12, light: "Pełne słońce.", humidity: "Niska.", toxic: true, tips: "W domu trudna — potrzebuje słońca i chłodnej zimy. Lepsza na balkon." },
  "ocimum": { pl: "Bazylia", waterSummer: 2, waterWinter: 4, light: "Pełne słońce.", humidity: "Średnia.", toxic: false, tips: "Podlewaj rano, zbieraj od góry (uszczykuj wierzchołki) — będzie się krzewić." },
  "mentha": { pl: "Mięta", waterSummer: 2, waterWinter: 5, light: "Jasno, znosi półcień.", humidity: "Średnia.", toxic: false, tips: "Stale wilgotna ziemia. Ekspansywna — w gruncie sadź w doniczce." },
  "petroselinum": { pl: "Pietruszka naciowa", waterSummer: 3, waterWinter: 5, light: "Jasno.", humidity: "Średnia.", toxic: false, tips: "Zbieraj zewnętrzne liście, środek zostaw do wzrostu." },
  "rosmarinus": { pl: "Rozmaryn", waterSummer: 5, waterWinter: 12, light: "Pełne słońce.", humidity: "Niska.", toxic: false, tips: "Bardziej znosi suszę niż zalanie. Zimą jasno i chłodno." },
  "salvia": { pl: "Szałwia", waterSummer: 5, waterWinter: 10, light: "Pełne słońce.", humidity: "Niska.", toxic: false, tips: "Przepuszczalna ziemia, umiarkowane podlewanie." },
  "thymus": { pl: "Tymianek", waterSummer: 6, waterWinter: 12, light: "Pełne słońce.", humidity: "Niska.", toxic: false, tips: "Im biedniejsza ziemia, tym intensywniejszy aromat." }
};

// Domyślna pielęgnacja, gdy rośliny nie ma w bazie.
var CARE_DEFAULT = {
  pl: null,
  waterSummer: 7, waterWinter: 12,
  light: "Większość roślin domowych lubi jasne, rozproszone światło.",
  humidity: "Średnia wilgotność. Obserwuj końcówki liści.",
  toxic: null,
  tips: "Złota zasada: sprawdź palcem 2–3 cm ziemi — podlewaj dopiero, gdy przeschnie. Więcej roślin ginie z przelania niż z suszy."
};

// Mapowanie kodów EPPO (Pl@ntNet diseases API) → polskie nazwy + porady.
var DISEASE_DB = {
  "APHISP": { pl: "Mszyce", what: "Drobne zielone/czarne owady na młodych pędach i pod liśćmi, lepka spadź.", action: "Spłucz silnym strumieniem wody, potem opryskaj roztworem szarego mydła (20 g/l). Powtarzaj co 3–4 dni. Przy dużej inwazji: preparat z olejkiem neem lub gotowy insektycyd do roślin doniczkowych." },
  "TETRUR": { pl: "Przędziorek chmielowiec", what: "Mikroskopijne roztocza; jasne nakłucia na liściach, delikatne pajęczynki.", action: "Zwiększ wilgotność (nie lubi jej), umyj roślinę pod prysznicem, opryskaj olejkiem neem lub akarycydem. Izoluj roślinę — łatwo się przenosi." },
  "TRIPSP": { pl: "Wciornastki", what: "Srebrzyste smugi i czarne kropki (odchody) na liściach, drobne wydłużone owady.", action: "Niebieskie/żółte tablice lepowe, oprysk preparatem ze spinosadem lub olejkiem neem, powtarzany co tydzień przez min. 3 tygodnie. Izoluj roślinę." },
  "PSEUCS": { pl: "Wełnowce", what: "Białe, watowate skupiska w kątach liści i na pędach.", action: "Usuń wacikiem nasączonym spirytusem, potem oprysk mydłem ogrodniczym lub neem. Sprawdzaj co kilka dni — jaja są ukryte." },
  "SAISCO": { pl: "Tarczniki / miseczniki", what: "Brązowe, wypukłe tarczki przyklejone do pędów i nerwów liści, lepka spadź.", action: "Zdrap tarczki (paznokciem/szczoteczką), przetrzyj spirytusem, opryskaj olejem parafinowym lub neem. Uporczywe — kontroluj przez kilka tygodni." },
  "BOTRCI": { pl: "Szara pleśń (Botrytis)", what: "Szary, puszysty nalot na liściach, kwiatach, pędach.", action: "Usuń porażone części, popraw wentylację, ogranicz zraszanie i zagęszczenie. W razie potrzeby fungicyd." },
  "ERYSSP": { pl: "Mączniak prawdziwy", what: "Biały, mączysty nalot na wierzchu liści.", action: "Usuń najbardziej porażone liście. Oprysk: 1 łyżeczka sody oczyszczonej + kropla mydła na litr wody, lub gotowy fungicyd. Więcej światła i ruchu powietrza." },
  "PEROSP": { pl: "Mączniak rzekomy", what: "Żółte plamy na wierzchu liścia, szary nalot od spodu.", action: "Usuń porażone liście, nie zraszaj liści, podlewaj od dołu, fungicyd miedziowy w razie potrzeby." },
  "PHYTSP": { pl: "Fytoftoroza / zgnilizna korzeni", what: "Więdnięcie mimo wilgotnej ziemi, ciemniejąca nasada pędu, gnijące korzenie.", action: "Wyjmij z doniczki, odetnij gnijące (brązowe, miękkie) korzenie, przesadź do świeżej, przepuszczalnej ziemi i czystej doniczki. Ogranicz podlewanie." },
  "COLLSP": { pl: "Antraknoza", what: "Brązowe/czarne zapadnięte plamy na liściach, często z żółtą obwódką.", action: "Usuń porażone liście (do kosza, nie na kompost), unikaj moczenia liści, fungicyd w razie postępu." },
  "ALTESP": { pl: "Alternarioza (plamistość liści)", what: "Ciemne plamy z koncentrycznymi pierścieniami.", action: "Usuń porażone liście, popraw cyrkulację powietrza, podlewaj od dołu. Fungicyd przy dużym porażeniu." },
  "SEPTSP": { pl: "Septorioza", what: "Drobne plamki z ciemną obwódką i jasnym środkiem.", action: "Usuń porażone liście, nie zraszaj, fungicyd miedziowy." },
  "PUCCSP": { pl: "Rdza", what: "Pomarańczowo-rdzawe brodawki od spodu liści.", action: "Usuń porażone liście, izoluj roślinę, fungicyd. Nie zraszaj liści." },
  "FUSASP": { pl: "Fuzarioza", what: "Więdnięcie, żółknięcie od dolnych liści, ciemnienie naczyń w pędzie.", action: "Trudna do wyleczenia. Spróbuj przesadzić do sterylnej ziemi po odcięciu chorych korzeni; przy silnym porażeniu roślinę niestety trzeba usunąć." },
  "XANTSP": { pl: "Bakteryjna plamistość", what: "Wodniste, później brunatne plamy, czasem z żółtą obwódką.", action: "Usuń porażone liście, nie zraszaj, dezynfekuj narzędzia. Brak skutecznych środków — liczy się higiena i wentylacja." },
  "VIRUSP": { pl: "Wirus (mozaika)", what: "Mozaikowate przebarwienia, deformacje liści.", action: "Wirusy roślin są nieuleczalne. Izoluj roślinę; jeśli objawy postępują — usuń ją, żeby chronić resztę kolekcji. Zwalczaj mszyce (przenoszą wirusy)." },
  "SCIASP": { pl: "Ziemiórki", what: "Małe czarne muszki latające nad doniczką; larwy w wilgotnej ziemi.", action: "Przesusz wierzchnią warstwę ziemi, żółte tablice lepowe, podlewanie z nicieniami SF (Steinernema feltiae) lub Bacillus thuringiensis israelensis. Wierzch ziemi przysyp piaskiem/żwirkiem." },
  "ALEYSP": { pl: "Mączlik", what: "Małe białe muszki zrywające się ze spodu liści.", action: "Żółte tablice lepowe, oprysk mydłem ogrodniczym lub neem co 4–5 dni (przerywa cykl rozwojowy). Izoluj roślinę." }
};

// Offline „Doktor objawowy" — diagnoza bez zdjęcia / bez internetu.
var SYMPTOMS_DB = [
  { id: "yellow-lower", label: "Żółkną dolne liście", causes: "Najczęściej przelanie lub naturalne starzenie. Rzadziej: niedobór azotu.", action: "Sprawdź wilgotność ziemi i czy doniczka ma odpływ. Jeśli ziemia stale mokra — wydłuż przerwy między podlewaniem. Pojedynczy stary liść = norma." },
  { id: "yellow-all", label: "Żółknie cała roślina", causes: "Przelanie i początek gnicia korzeni, albo silny niedobór światła/składników.", action: "Wyjmij bryłę z doniczki i obejrzyj korzenie: brązowe i miękkie = gnicie (odetnij, przesadź do świeżej ziemi). Zdrowe = przenieś jaśniej i zasil nawozem." },
  { id: "brown-tips", label: "Brązowe, suche końcówki liści", causes: "Suche powietrze, twarda/chlorowana woda, przesuszanie lub przenawożenie.", action: "Zraszaj lub postaw nawilżacz, podlewaj odstaną/filtrowaną wodą, sprawdź regularność podlewania." },
  { id: "brown-spots", label: "Brązowe plamy na liściach", causes: "Grzybowa plamistość (wilgotne liście), oparzenia słoneczne lub zimna woda na liściach.", action: "Usuń porażone liście, nie mocz liści przy podlewaniu, odsuń od ostrego słońca. Plamy z obwódką szerzące się = potraktuj fungicydem." },
  { id: "drooping-wet", label: "Roślina zwiędnięta, a ziemia mokra", causes: "Zalanie — korzenie się duszą lub gniją.", action: "Natychmiast: wyjmij z osłonki, sprawdź odpływ, wyjmij bryłę i osusz na gazecie. Gnijące korzenie odetnij, przesadź do świeżej przepuszczalnej ziemi. Nie podlewaj aż przeschnie." },
  { id: "drooping-dry", label: "Roślina zwiędnięta i ziemia sucha", causes: "Przesuszenie.", action: "Zanurz całą doniczkę w wodzie na 20–30 min (kąpiel), odsącz. Jeśli ziemia odpycha wodę — to znak, że torf przesechł; kąpiel to naprawia. Skróć interwał podlewania." },
  { id: "leaf-drop", label: "Zrzuca liście", causes: "Szok: przestawienie, przeciąg, nagła zmiana temperatury; u fikusów klasyka. Też zalanie.", action: "Ustal stałe miejsce bez przeciągów. Sprawdź wilgotność ziemi. Daj 2–3 tygodnie spokoju — zwykle odbija." },
  { id: "stretching", label: "Wyciąga się, blednie, małe liście", causes: "Za mało światła.", action: "Przenieś bliżej okna (Wschód/Zachód idealne) lub dołóż lampę do roślin. Zimą to częste — można skrócić podlewanie." },
  { id: "webbing", label: "Pajęczynki, jasne kropki na liściach", causes: "Przędziorek.", action: "Umyj roślinę pod prysznicem, zwiększ wilgotność, opryskaj neem/akarycydem, izoluj od innych roślin. Powtórz oprysk po tygodniu." },
  { id: "sticky", label: "Lepkie liście / lepka podłoga obok", causes: "Spadź — wydzielina mszyc, tarczników lub wełnowców.", action: "Obejrzyj dokładnie pędy i spody liści. Znajdź szkodnika (mszyce/tarczniki/wełnowce) i działaj jak w opisie danego szkodnika: mydło ogrodnicze, spirytus, neem." },
  { id: "flies", label: "Małe muszki nad doniczką", causes: "Ziemiórki — larwy żyją w stale wilgotnej ziemi.", action: "Przesuszaj wierzchnią warstwę ziemi między podlewaniami, żółte tablice lepowe, wierzch przysyp żwirkiem. Przy dużej inwazji: nicienie SF do podlania." },
  { id: "white-fluff", label: "Białe, watowate kłaczki", causes: "Wełnowce.", action: "Przetrzyj wacikiem ze spirytusem każdy kłaczek, potem oprysk mydłem/neem. Kontroluj co kilka dni przez miesiąc." },
  { id: "white-powder", label: "Biały mączysty nalot na liściach", causes: "Mączniak prawdziwy.", action: "Usuń najgorsze liście, oprysk sodą (łyżeczka + kropla mydła na litr) lub fungicydem, popraw wentylację." },
  { id: "no-flowers", label: "Nie kwitnie", causes: "Za mało światła, brak okresu spoczynku albo przenawożenie azotem.", action: "Więcej światła, zimą chłodniej i mniej wody (spoczynek), nawóz dla roślin kwitnących (więcej P i K)." },
  { id: "rotting-base", label: "Gnijąca, miękka nasada / pędy", causes: "Zgnilizna — zwykle skutek przelania, u sukulentów wody na rozecie.", action: "Odetnij do zdrowej tkanki sterylnym nożem. U sukulentów ukorzeń zdrowy wierzchołek. Przesadź do suchej, przepuszczalnej ziemi." }
];
