/* ==================================
   VERIFY PAGE
================================== */

import { db } from "./firebase.js";

import {

    doc,
    getDoc

} from "https://www.gstatic.com/firebasejs/12.16.0/firebase-firestore.js";

/* ==================================
   DICE IMAGES
================================== */

const diceImages = [

    "images/red.png",
    "images/blue.png",
    "images/green.png",
    "images/yellow.png",
    "images/purple.png",
    "images/orange.png"

];

/* ==================================
   ELEMENTS
================================== */

const input =
    document.getElementById("gameIdInput");

const button =
    document.getElementById("verifyButton");

const results =
    document.getElementById("results");

/* ==================================
   VERIFY GAME
================================== */

async function verifyGame(){

    const gameId =
        input.value.trim();

    if(gameId===""){

        results.innerHTML=`

        <tr>

            <td colspan="3">

                Please enter a Game ID.

            </td>

        </tr>

        `;

        return;

    }

    const snap =
        await getDoc(

            doc(
                db,
                "games",
                gameId
            )

        );

    if(!snap.exists()){

        results.innerHTML=`

        <tr>

            <td colspan="3">

                Game ID not found.

            </td>

        </tr>

        `;

        return;

    }

    const game =
        snap.data();

    results.innerHTML="";

    for(

        let i=0;

        i<6;

        i++

    ){

        const row =
            document.createElement("tr");

        let diceHTML="";

        if(i < game.currentRoll){

            game.rolls[i].forEach(value=>{

                diceHTML += `

                <img
                    src="${diceImages[value]}"
                    class="historyDice">

                `;

            });

        }else{

            diceHTML =

                "<strong>Waiting...</strong>";

        }

        row.innerHTML=`

        <td>

            ${i+1}

        </td>

        <td>

            ${diceHTML}

        </td>

        `;

        results.appendChild(row);

    }

}

button.addEventListener(

    "click",

    verifyGame

);