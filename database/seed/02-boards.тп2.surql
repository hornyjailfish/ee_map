# выбираем только одну запись из щитовых
let $room = SELECT id FROM ONLY electric_rooms
    WHERE name = "ТП-2" LIMIT 1;

INSERT IGNORE INTO boards [
    {
        name: "ГРЩ-1 ячейка 1",
        room: $room.id
    },
    {
        name: "ГРЩ-1 ячейка 2",
        room: $room.id
    },
    {
        name: "ГРЩ-1 ячейка 6",
        room: $room.id
    },
    {
        name: "ГРЩ-1 ячейка 7",
        room: $room.id
    },
    {
        name: "ГРЩ-2 ячейка 1",
        room: $room.id
    },
    {
        name: "ГРЩ-2 ячейка 2",
        room: $room.id
    },
    {
        name: "ГРЩ-2 ячейка 6",
        room: $room.id
    },
    {
        name: "ГРЩ-2 ячейка 7",
        room: $room.id
    },
];

INSERT IGNORE INTO boards [
    # вру
    {
        name: "ВРУ 1-1",
        room: $room.id
    },
    # щит с ручкой переключения ввода
    {
        name: "ВРУ 1-2",
        room: $room.id
    },
    {
        name: "ВРУ 1-3",
        room: $room.id
    },
    # ???
    {
        name: "АВР 1-4",
        room: $room.id
    },
];

INSERT IGNORE INTO boards [
    # щит с ручкой переключения ввода
    {
        name: "ВРУ 2-1",
        room: $room.id
    },
    {
        name: "ВРУ 2-2",
        room: $room.id
    },
    # вру
    {
        name: "АВР 2-3",
        room: $room.id
    },
    # ???
    {
        name: "ВРУ 2-4",
        room: $room.id
    },
];

INSERT IGNORE INTO boards [
    # ???
    {
        name: "АВР 3-1",
        room: $room.id
    },
    # щит с ручкой переключения ввода
    {
        name: "ВРУ 3-2",
        room: $room.id
    },
    {
        name: "ВРУ 3-3",
        room: $room.id
    },
    # вру
    {
        name: "ВРУ 3-4",
        room: $room.id
    },

];

INSERT IGNORE INTO boards [
    # щит с ручкой переключения ввода
    {
        name: "ВРУ 4-1",
        room: $room.id
    },
    {
        name: "ВРУ 4-2",
        room: $room.id
    },
    # вру
    {
        name: "ВРУ 4-3",
        room: $room.id
    },
];

INSERT IGNORE INTO boards [
    # щит с ручкой переключения ввода
    {
        name: "ВРУ 5-1",
        room: $room.id
    },
    {
        name: "ВРУ 5-2",
        room: $room.id
    },
    # вру
    {
        name: "ВРУ 5-3",
        room: $room.id
    },
    # ???
    {
        name: "ВРУ 5-4",
        room: $room.id
    },
];

INSERT IGNORE INTO boards [
    # щит с ручкой переключения ввода
    {
        name: "ВРУ 6-1",
        room: $room.id
    },
    {
        name: "ВРУ 6-2",
        room: $room.id
    },
    # вру
    {
        name: "ВРУ 6-3",
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
        name: "ЩСО",
        room: $room.id
    },
    {
        name: "ЩСДУ",
        room: $room.id
    },
];
