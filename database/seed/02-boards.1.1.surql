# выбираем только одну запись из щитовых
let $room = SELECT id FROM ONLY electric_rooms
    WHERE name = "1.1" LIMIT 1;

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
# автоматы в щите ЩР-1
{
    let $board = SELECT id FROM ONLY boards
        WHERE name = "ЩР-1" LIMIT 1;
    INSERT IGNORE INTO breakers [
        {
            name: "Q0",
            description: "Вводной",
            board: $board.id
        },
        {
            name: "Q1",
            value: 16,
            board: $board.id
        },
        {
            name: "Q2",
            value: 16,
            board: $board.id
        },
        {
            name: "Q3",
            value: 50,
            board: $board.id
        },
        {
            name: "Q4",
            value: 25,
            board: $board.id
        },
        {
            name: "Q5",
            value: 25,
            board: $board.id
        },
        {
            name: "Q6",
            value: 25,
            board: $board.id
        },
        {
            name: "Q7",
            value: 32,
            board: $board.id
        },
        {
            name: "Q8",
            value: 32,
            board: $board.id
        },
        {
            name: "Q9",
            value: 25,
            board: $board.id
        },
        {
            name: "Q10",
            value: 25,
            board: $board.id
        },
        {
            name: "Q11",
            value: 16,
            board: $board.id
        },
    ];

    # relate Q0 to all other breakers in board
    let $list = SELECT VALUE id FROM breakers WHERE board = $board.id AND name != "Q0";
    let $root = SELECT VALUE id FROM ONLY breakers WHERE board = $board.id AND name = "Q0" LIMIT 1;

    FOR $out IN $list {
        INSERT RELATION IGNORE INTO connects {
            in: $root,
            out: $out
        };
    };
};
{
# автоматы в щите ЩР-2
    let $board = SELECT id FROM ONLY boards
        WHERE name = "ЩР-2" LIMIT 1;
    INSERT IGNORE INTO breakers [
        {
            name: "Q0",
            description: "Вводной",
            board: $board.id
        },
        {
            name: "Q1",
            value: 16,
            board: $board.id
        },
        {
            name: "Q2",
            value: 40,
            board: $board.id
        },
        {
            name: "Q3",
            value: 50,
            board: $board.id
        },
        {
            name: "Q4",
            value: 25,
            board: $board.id
        },
        {
            name: "Q5",
            value: 25,
            board: $board.id
        },
        {
            name: "Q6",
            value: 25,
            board: $board.id
        },
        {
            name: "Q7",
            value: 32,
            board: $board.id
        },
        {
            name: "Q8",
            value: 32,
            board: $board.id
        },
        {
            name: "Q9",
            value: 25,
            board: $board.id
        },
        {
            name: "Q10",
            value: 40,
            board: $board.id
        },
    ];
    # repeat because i think its correctly to do for each board individualy
    let $list = SELECT VALUE id FROM breakers WHERE board = $board.id AND name != "Q0";
    let $root = SELECT VALUE id FROM ONLY breakers WHERE board = $board.id AND name = "Q0" LIMIT 1;

    FOR $out IN $list {
        INSERT RELATION IGNORE INTO connects {
            in: $root,
            out: $out
        };
    };
};

{
# автоматы в щите ЩСТЗ
    let $board = SELECT id FROM ONLY boards
        WHERE name = "ЩСТЗ" LIMIT 1;
    INSERT IGNORE INTO breakers [
        {
            name: "Q0",
            description: "Вводной",
            board: $board.id
        },
    ];
};


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
        name: "ЩС",
        room: $room.id
    },
    {
        name: "ЩК",
        room: $room.id
    },
    {
        name: "ЩПВ",
        room: $room.id
    },
];

{
# автоматы в щите ЩО-1
    let $board = SELECT id FROM ONLY boards
        WHERE name = "ЩО-1" LIMIT 1;
    INSERT IGNORE INTO breakers [
        {
            name: "Q0",
            description: "Вводной",
            board: $board.id
        },
    ];
};

{
# автоматы в щите ЩО-2
    let $board = SELECT id FROM ONLY boards
        WHERE name = "ЩО-2" LIMIT 1;
    INSERT IGNORE INTO breakers [
        {
            name: "Q0",
            description: "Вводной",
            board: $board.id
        },
    ];
};

{
# автоматы в щите ЩАО
    let $board = SELECT id FROM ONLY boards
        WHERE name = "ЩАО" LIMIT 1;
    INSERT IGNORE INTO breakers [
        {
            name: "Q0",
            description: "Вводной",
            board: $board.id
        },
    ];
};

{
# автоматы в щите ЩС
    let $board = SELECT id FROM ONLY boards
        WHERE name = "ЩС" LIMIT 1;
    INSERT IGNORE INTO breakers [
        {
            name: "Q0",
            description: "Вводной",
            board: $board.id
        },
    ];
};
{
# автоматы в щите ЩК
    let $board = SELECT id FROM ONLY boards
        WHERE name = "ЩК" LIMIT 1;
    INSERT IGNORE INTO breakers [
        {
            name: "Q0",
            description: "Вводной",
            board: $board.id
        },
    ];
};
{
# автоматы в щите ЩПВ
    let $board = SELECT id FROM ONLY boards
        WHERE name = "ЩПВ" LIMIT 1;
    INSERT IGNORE INTO breakers [
        {
            name: "Q0",
            description: "Вводной",
            board: $board.id
        },
    ];
};
