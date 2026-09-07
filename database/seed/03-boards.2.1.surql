# выбираем только одну запись из щитовых
let $room = SELECT id FROM ONLY electric_rooms
    WHERE name = "2.1" LIMIT 1;

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
        name: "ЩР-3",
        room: $room.id
    },
    {
        name: "ЩР-4",
        room: $room.id
    },
    {
        name: "ЩР-5",
        room: $room.id
    },
];

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
        name: "ЩАО",
        room: $room.id
    },
    {
        name: "ЩПВ",
        room: $room.id
    },
];
