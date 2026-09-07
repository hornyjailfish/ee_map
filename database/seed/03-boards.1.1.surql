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
    let $board = fn::get_board_from_room("ЩР-1", $room);
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
    fn::default_relation($board);
};

{
# автоматы в щите ЩР-2
    let $board = fn::get_board_from_room("ЩР-2", $room);
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
    fn::default_relation($board);
};

{
# автоматы в щите ЩСТЗ
    let $board = fn::get_board_from_room("ЩСТЗ", $room);
    INSERT IGNORE INTO breakers [
        {
            name: "Q0",
            description: "Вводной",
            board: $board.id
        },
        {
            name: "Q1",
            value: 50,
            board: $board.id
        },
        {
            name: "Q2",
            value: 32,
            board: $board.id
        },
        {
            name: "Q3",
            value: 20,
            board: $board.id
        },
        {
            name: "Q4",
            value: 20,
            board: $board.id
        },
        {
            name: "Q5",
            value: 20,
            board: $board.id
        },
        {
            name: "Q6",
            value: 50,
            board: $board.id
        },
        {
            name: "Q7",
            value: 32,
            board: $board.id
        },
        {
            name: "Q8",
            value: 16,
            board: $board.id
        },
        {
            name: "Q9",
            value: 16,
            board: $board.id
        },
        {
            name: "Q10",
            value: 16,
            board: $board.id
        },
        {
            name: "Q11",
            value: 50,
            board: $board.id
        },
        {
            name: "Q12",
            value: 25,
            board: $board.id
        },
        {
            name: "Q13",
            value: 25,
            board: $board.id
        },
    ];
    fn::default_relation($board);
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
    let $board = fn::get_board_from_room("ЩО-1", $room);
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
    let $board = fn::get_board_from_room("ЩО-2", $room);
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
    let $board = fn::get_board_from_room("ЩАО", $room);
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
    let $board = fn::get_board_from_room("ЩС", $room);
    INSERT IGNORE INTO breakers [
        {
            name: "Q0",
            description: "Вводной",
            board: $board.id
        },
        {
            name: "Q1",
            board: $board.id
        },
        {
            name: "Q2",
            board: $board.id
        },
        {
            name: "Q3",
            board: $board.id
        },
        {
            name: "Q4",
            board: $board.id
        },
        {
            name: "Q5",
            board: $board.id
        },
        {
            name: "Q6",
            board: $board.id
        },
        {
            name: "Q7",
            board: $board.id
        },
        {
            name: "Q8",
            board: $board.id
        },
        {
            name: "Q9",
            board: $board.id
        },
    ];
    fn::default_relation($board);
};

{
# автоматы в щите ЩК
    let $board = fn::get_board_from_room("ЩК", $room);
    INSERT IGNORE INTO breakers [
        {
            name: "Q0",
            description: "Вводной",
            board: $board.id
        },
        {
            name: "Q1",
            board: $board.id
        },
        {
            name: "Q2",
            board: $board.id
        },
        {
            name: "Q3",
            board: $board.id
        },
        {
            name: "Q4",
            board: $board.id
        },
        {
            name: "Q5",
            board: $board.id
        },
        {
            name: "Q6",
            board: $board.id
        },
    ];
    fn::default_relation($board);
};

{
# автоматы в щите ЩПВ
    let $board = fn::get_board_from_room("ЩПВ", $room);
    INSERT IGNORE INTO breakers [
        {
            name: "Q0",
            description: "Вводной",
            board: $board.id
        },
        {
            name: "Q1",
            board: $board.id
        },
        {
            name: "Q2",
            board: $board.id
        },
        {
            name: "Q3",
            board: $board.id
        },
        {
            name: "Q4",
            board: $board.id
        },
        {
            name: "Q5",
            board: $board.id
        },
        {
            name: "Q6",
            board: $board.id
        },
        {
            name: "Q7",
            board: $board.id
        },
    ];
    fn::default_relation($board);
};
