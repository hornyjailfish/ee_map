# выбираем только одну запись из щитовых с именем -8.7
let $room = SELECT id FROM ONLY electric_rooms
    WHERE name = "-8.7" LIMIT 1;
# ВРУшки
INSERT IGNORE INTO boards [
    {
        name: "ВРУ 1-1",
        room: $room.id
    },
    {
        name: "ВРУ 2-1",
        room: $room.id
    },
    {
        name: "ВРУ 2-2",
        room: $room.id
    },
];
# ЩО
INSERT IGNORE INTO boards [
    {
        name: "ЩО-1",
        room: $room.id
    },
    {
        name: "ЩО-2",
        room: $room.id
    },
    {
        name: "ЩО-3",
        room: $room.id
    },
    {
        name: "ЩО-4",
        room: $room.id
    },
    {
        name: "ЩО-5",
        room: $room.id
    },
];
# ЩАО
INSERT IGNORE INTO boards [
    {
        name: "ЩАО-1",
        room: $room.id
    },
    {
        name: "ЩАО-2",
        room: $room.id
    },
    {
        name: "ЩАО-3",
        room: $room.id
    },
];
