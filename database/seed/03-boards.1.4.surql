# выбираем только одну запись из щитовых
let $room = SELECT id FROM ONLY electric_rooms
    WHERE name = "1.4" LIMIT 1;

# TODO!
INSERT IGNORE INTO boards [
    {
        name: "ЩР-1",
        room: $room.id
    },
    {
        name: "ЩР-2",
        room: $room.id
    },
    {
        name: "ЩСТЗ",
        room: $room.id
    },
];

INSERT IGNORE INTO boards [
    {
        name: "ЩПВ",
        room: $room.id
    },
    {
        name: "ЩК",
        room: $room.id
    },
    {
        name: "ЩС",
        room: $room.id
    },
    {
        name: "ЩСУ-И",
        room: $room.id
    },
    {
        name: "ЩСУ-М",
        room: $room.id
    },
    {
        name: "ЩСУ-Ж",
        room: $room.id
    },
];
