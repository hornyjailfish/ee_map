# выбираем только одну запись из щитовых
let $room = SELECT id FROM ONLY electric_rooms
    WHERE name = "-1.8" LIMIT 1;
