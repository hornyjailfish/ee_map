# выбираем только одну запись из щитовых
let $room = SELECT id FROM ONLY electric_rooms
    WHERE name = "ТП-1" LIMIT 1;

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
    # щит с ручкой переключения ввода
    {
        name: "ВРУ 1-1",
        room: $room.id
    },
    {
        name: "ВРУ 1-2",
        room: $room.id
    },
    # вру
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
        name: "ВРУ 2-3",
        room: $room.id
    },
    # ???
    {
        name: "АВР 2-4",
        room: $room.id
    },
];

{
# автоматы в щите АВР 2-4
    let $board = fn::get_board_from_room("АВР 2-4", $room);
    INSERT IGNORE INTO breakers [
        {
            name: "Q1",
            value: 250,
            board: $board.id
        },
        {
            name: "Q2",
            value: 16,
            board: $board.id
        },
        {
            name: "Q3",
            value: 16,
            board: $board.id
        },
        {
            name: "Q4",
            value: 25,
            board: $board.id
        },
        {
            name: "Q5",
            value: 16,
            board: $board.id
        },
        {
            name: "Q6",
            value: 40,
            board: $board.id
        },
    ];

};

INSERT IGNORE INTO boards [
    # щит с ручкой переключения ввода
    {
        name: "ВРУ 3-1",
        room: $room.id
    },
    {
        name: "ВРУ 3-2",
        room: $room.id
    },
    # вру
    {
        name: "ВРУ 3-3",
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
    # отдельно из грщ
    {
        name: "ВРУ 4-4",
        room: $room.id
    },
];

INSERT IGNORE INTO boards [
    # щит с ручкой переключения ввода
    {
        name: "ВРУ 5-2",
        room: $room.id
    },
    {
        name: "ВРУ 5-3",
        room: $room.id
    },
    # вру
    {
        name: "ВРУ 5-1",
        room: $room.id
    },
    # ???
    {
        name: "АВР 5-4",
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
        name: "СК Мост",
        room: $room.id
    },
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
];

{
# автоматы в маленькие щиты
    let $board = fn::get_board_from_room("ЩО-1", $room);
    INSERT IGNORE INTO breakers [
        {
            name: "Q0",
            value: 80,
            board: $board.id
        },
    ];

    let $board = fn::get_board_from_room("ЩО-2", $room);
    INSERT IGNORE INTO breakers [
        {
            name: "Q0",
            value: 80,
            board: $board.id
        },
    ];

    let $board = fn::get_board_from_room("ЩАО", $room);
    INSERT IGNORE INTO breakers [
        {
            name: "Q0",
            value: 40,
            board: $board.id
        },
    ];
};
